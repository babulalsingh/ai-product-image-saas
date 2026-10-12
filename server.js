import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import OpenAI from 'openai';
import admin from 'firebase-admin';
import { fileTypeFromBuffer } from 'file-type';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const FREE_CREDITS = 20;
const MAX_IMAGES = 4;
const ALLOWED_RATIOS = new Set(['1:1', '4:5', '3:4', '16:9', '9:16']);
const PAID_PLANS = new Set(['pro', 'business']);

if (!process.env.OPENAI_API_KEY) console.warn('WARNING: OPENAI_API_KEY is not configured. Generation will not work until configured.');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing-key' });

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();
const auth = admin.auth();

app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://www.gstatic.com'], styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'", 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com']
} }}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

async function requireUser(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Please sign in first.' });
    req.user = await auth.verifyIdToken(token, true);
    next();
  } catch {
    return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}

function ratioToSize(ratio) {
  // The image API supports a finite set of native sizes. Ratios are mapped to the closest supported size.
  if (ratio === '16:9') return '1536x1024';
  if (ratio === '9:16' || ratio === '4:5' || ratio === '3:4') return '1024x1536';
  return '1024x1024';
}

const templates = {
  amazon: 'Create a professional marketplace product image. Clean pure white background, centered product, soft realistic studio lighting, subtle natural shadow, sharp focus, accurate product appearance, no extra objects, no invented logos or text. Keep the uploaded product recognizable and preserve its shape, color, materials and details.',
  etsy: 'Create a polished Etsy listing image with warm handmade boutique styling, natural light, tasteful uncluttered scene, and the uploaded product as the clear focal point. Preserve the product accurately.',
  luxury: 'Create premium luxury studio product photography with controlled softbox lighting, elegant restrained background, refined reflections and realistic material texture. Preserve the product accurately.',
  lifestyle: 'Create a realistic lifestyle product photograph showing the uploaded product in a plausible, tasteful setting. Keep the product itself faithful to the source image.',
  infographic: 'Create a clean e-commerce product feature graphic with generous whitespace and simple visual hierarchy. Do not invent product specifications, certifications, measurements or claims. Preserve the product accurately.',
  social: 'Create a modern social-media promotional product image with attractive composition, tasteful styling and clear focus on the product. Preserve the product accurately.'
};

async function getOrCreateUser(uid, email) {
  const ref = db.collection('users').doc(uid);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const data = { email: email || null, plan: 'free', credits: FREE_CREDITS, createdAt: admin.firestore.FieldValue.serverTimestamp() };
      tx.set(ref, data);
      return { ...data, credits: FREE_CREDITS };
    }
    const d = snap.data();
    return { email: d.email || email || null, plan: d.plan || 'free', credits: Number(d.credits ?? 0) };
  });
}

app.get('/api/me', requireUser, async (req, res) => {
  try {
    const user = await getOrCreateUser(req.user.uid, req.user.email);
    res.json({ uid: req.user.uid, email: user.email, plan: user.plan, credits: user.credits, freeCredits: FREE_CREDITS });
  } catch (e) { console.error('profile error', e); res.status(500).json({ error: 'Could not load account.' }); }
});

app.get('/api/templates', (_req, res) => res.json({ templates: Object.keys(templates).map(id => ({ id, name: ({amazon:'Amazon Product',etsy:'Etsy Listing',luxury:'Luxury Studio',lifestyle:'Lifestyle Scene',infographic:'Product Infographic',social:'Social Media'})[id] })) }));

app.post('/api/generate', requireUser, upload.single('image'), async (req, res) => {
  let reserved = false;
  let reservedCost = 0;
  let jobRef = null;
  const uid = req.user.uid;
  const count = Number(req.body.count || 4);
  const ratio = String(req.body.ratio || '1:1');
  const quality = String(req.body.quality || '1080p');
  const templateId = String(req.body.template || 'amazon');
  const prompt = String(req.body.prompt || '').trim().slice(0, 1500);

  try {
    if (!req.file) return res.status(400).json({ error: 'Upload a product photo first.' });
    if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGES) return res.status(400).json({ error: 'Choose between 1 and 4 images per request.' });
    if (!ALLOWED_RATIOS.has(ratio)) return res.status(400).json({ error: 'Unsupported aspect ratio.' });
    if (!['720p', '1080p', '2K', '4K'].includes(quality)) return res.status(400).json({ error: 'Unsupported quality option.' });
    if (!templates[templateId]) return res.status(400).json({ error: 'Choose a valid template.' });
    if (prompt.length < 3) return res.status(400).json({ error: 'Describe the image you want.' });
    const detected = await fileTypeFromBuffer(req.file.buffer);
    if (!detected || !['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime)) return res.status(400).json({ error: 'Use a JPG, PNG or WEBP image.' });

    const userRef = db.collection('users').doc(uid);
    jobRef = db.collection('generationJobs').doc();
    const creditCost = count * (quality === '4K' ? 4 : quality === '2K' ? 2 : 1);
    reservedCost = creditCost;
    await db.runTransaction(async tx => {
      const snap = await tx.get(userRef);
      let user = snap.exists ? snap.data() : { plan: 'free', credits: FREE_CREDITS, email: req.user.email || null };
      if (!snap.exists) tx.set(userRef, { ...user, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      const plan = String(user.plan || 'free').toLowerCase();
      if (quality !== '720p' && quality !== '1080p' && !PAID_PLANS.has(plan)) {
        const err = new Error('2K and 4K generation require a Pro or Business subscription.'); err.status = 402; throw err;
      }
      const credits = Number(user.credits ?? 0);
      if (credits < creditCost) { const err = new Error('Not enough credits. Upgrade your plan or add credits.'); err.status = 402; throw err; }
      tx.set(userRef, { ...user, credits: credits - creditCost, email: user.email || req.user.email || null }, { merge: true });
      tx.set(jobRef, { uid, count, ratio, quality, template: templateId, status: 'processing', creditsCharged: creditCost, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    reserved = true;

    const basePrompt = templates[templateId];
    const fullPrompt = `${basePrompt}\nUser instructions: ${prompt}\nAspect ratio target: ${ratio}. Create a distinct variation. Avoid misleading claims and do not change the actual product identity.`;
    // Native API sizes are limited; the 1080p selection maps to the closest supported native output size.
    // A production 2K/4K plan should add an actual upscaling provider before claiming exact 2K/4K pixels.
    const response = await openai.images.edit({
      model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
      image: new File([req.file.buffer], `product.${detected.ext}`, { type: detected.mime }),
      prompt: fullPrompt,
      n: count,
      size: ratioToSize(ratio),
      quality: quality === '720p' ? 'low' : quality === '1080p' ? 'medium' : 'high',
      output_format: 'png'
    });
    const images = (response.data || []).filter(x => x.b64_json).map((x, i) => ({ id: `${jobRef.id}-${i + 1}`, filename: `product-${i + 1}.png`, dataUrl: `data:image/png;base64,${x.b64_json}` }));
    if (!images.length) throw new Error('The image provider returned no images. Please try again.');
    await jobRef.update({ status: 'completed', imageCount: images.length, completedAt: admin.firestore.FieldValue.serverTimestamp() });
    const userSnap = await userRef.get();
    res.json({ images, creditsUsed: creditCost, creditsRemaining: Number(userSnap.data()?.credits ?? 0), note: quality === '1080p' ? 'The provider returns a supported native size; this setting is not a guarantee of exact 1080-pixel dimensions.' : undefined });
  } catch (err) {
    console.error('generation failed:', err?.message || err);
    if (reserved) {
      try {
        const userRef = db.collection('users').doc(uid);
        await db.runTransaction(async tx => {
          const userSnap = await tx.get(userRef);
          if (userSnap.exists) tx.update(userRef, { credits: Number(userSnap.data().credits || 0) + reservedCost });
        });
        if (jobRef) await jobRef.set({ status: 'failed', failedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      } catch (refundErr) { console.error('credit refund failed:', refundErr?.message || refundErr); }
    }
    const status = err.status || (err.code === 'insufficient_quota' ? 402 : 500);
    res.status(status).json({ error: err.message || 'Image generation failed. Please try again.' });
  }
});

app.get('/api/history', requireUser, async (req, res) => {
  try {
    const snap = await db.collection('generationJobs').where('uid', '==', req.user.uid).orderBy('createdAt', 'desc').limit(25).get();
    res.json({ jobs: snap.docs.map(d => { const x = d.data(); return { id: d.id, status: x.status, template: x.template, ratio: x.ratio, quality: x.quality, imageCount: x.imageCount || 0, createdAt: x.createdAt?.toDate?.().toISOString() || null }; }) });
  } catch (e) { console.error('history error', e); res.status(500).json({ error: 'Could not load history.' }); }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 10 MB or smaller.' : 'Invalid upload.' });
  console.error(err); res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => console.log(`AI Product Image Generator running at http://localhost:${PORT}`));
