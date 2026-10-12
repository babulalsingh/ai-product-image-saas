import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const $ = (id) => document.getElementById(id);
const configReady = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_') && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith('YOUR_');
let firebaseApp, auth, currentUser = null, latestImages = [];

function message(id, text, type = '') { const el = $(id); el.textContent = text; el.className = `message ${type}`; }
function show(el, yes = true) { el.classList.toggle('hidden', !yes); }
function setBusy(busy) { $('generateBtn').disabled = busy; $('generateBtn').textContent = busy ? 'Generating your images…' : '✦ Generate images →'; }
async function api(path, options = {}) {
  if (!currentUser) throw new Error('Please sign in first.');
  const token = await currentUser.getIdToken();
  const response = await fetch(path, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

if (!configReady) {
  $('authMessage').textContent = 'Setup needed: add your Firebase Web App config in public/firebase-config.js, then enable Email/Password sign-in in Firebase Console.';
  $('authMessage').classList.add('message');
  $('authForm').addEventListener('submit', e => { e.preventDefault(); message('authMessage', 'First configure Firebase in public/firebase-config.js and enable Email/Password sign-in.'); });
  $('createAccountBtn').addEventListener('click', () => message('authMessage', 'First configure Firebase in public/firebase-config.js and enable Email/Password sign-in.'));
} else {
  firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  onAuthStateChanged(auth, async user => {
    currentUser = user;
    show($('authBox'), !user); show($('generatorForm'), !!user); show($('signOutBtn'), !!user);
    if (user) { try { await loadAccount(); } catch (e) { message('generationMessage', e.message); } }
    else { $('planPill').textContent = 'Free plan'; }
  });
  $('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value); message('authMessage', 'Signed in. Loading your account…'); }
    catch (err) { message('authMessage', friendlyAuthError(err)); }
  });
  $('createAccountBtn').addEventListener('click', async () => {
    try {
  await createUserWithEmailAndPassword(
    auth,
    $('email').value.trim(),
    $('password').value
  );
} catch (err) {
  message('authMessage', friendlyAuthError(err));
}
  });
  $('signOutBtn').addEventListener('click', () => signOut(auth));
}
function friendlyAuthError(err) {
  const map = { 'auth/invalid-email': 'Enter a valid email address.', 'auth/weak-password': 'Choose a password with at least 6 characters.', 'auth/email-already-in-use': 'This email already has an account. Please sign in.', 'auth/invalid-credential': 'Email or password is incorrect.', 'auth/operation-not-allowed': 'Enable Email/Password sign-in in Firebase Console.' };
  return map[err.code] || err.message || 'Could not sign in.';
}

async function loadAccount() {
  const me = await api('/api/me');
  $('planPill').textContent = `${me.plan[0].toUpperCase()}${me.plan.slice(1)} plan · ${me.credits} credits`;
  updateCreditEstimate();
}
$('imageInput').addEventListener('change', () => {
  const file = $('imageInput').files[0];
  if (!file) { show($('preview'), false); $('uploadTitle').textContent = 'Upload product photo'; $('uploadHint').textContent = 'JPG, PNG or WEBP · Max 10 MB'; return; }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    $('imageInput').value = ''; message('generationMessage', 'Choose a JPG, PNG or WEBP image up to 10 MB.'); return;
  }
  $('preview').src = URL.createObjectURL(file); show($('preview')); $('uploadTitle').textContent = file.name; $('uploadHint').textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · Ready`; message('generationMessage', '');
});
['count','quality'].forEach(id => $(id).addEventListener('change', updateCreditEstimate));
function updateCreditEstimate() {
  const count = Number($('count').value || 4), quality = $('quality').value;
  const credits = count * (quality === '4K' ? 4 : quality === '2K' ? 2 : 1);
  $('creditCost').textContent = `${credits} credit${credits === 1 ? '' : 's'}`;
  $('creditDescription').textContent = quality === '4K' || quality === '2K' ? 'Pro/Business subscription required' : `Free plan · ${quality} selected`;
}
$('generatorForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!currentUser) return message('generationMessage', 'Please sign in first.');
  const file = $('imageInput').files[0]; if (!file) return message('generationMessage', 'Upload a product photo first.');
  const form = new FormData(); form.append('image', file); form.append('prompt', $('prompt').value); form.append('template', $('template').value); form.append('ratio', $('ratio').value); form.append('count', $('count').value); form.append('quality', $('quality').value);
  setBusy(true); message('generationMessage', 'Preparing your request… This can take a little while.'); show($('emptyState'), false); $('results').replaceChildren(); show($('downloadAllBtn'), false); $('qualityNote').textContent = '';
  try {
    const data = await api('/api/generate', { method: 'POST', body: form });
    latestImages = data.images || []; renderImages(latestImages); message('generationMessage', `Done! Generated ${latestImages.length} image(s). ${data.creditsUsed} credits used.`);
    $('qualityNote').textContent = data.note || ''; show($('downloadAllBtn'), latestImages.length > 1); await loadAccount();
  } catch (err) { show($('emptyState'), true); message('generationMessage', err.message); try { await loadAccount(); } catch {} }
  finally { setBusy(false); }
});
function renderImages(images) {
  const grid = $('results'); grid.replaceChildren();
  images.forEach((item, index) => {
    const card = document.createElement('article'); card.className = 'result-card';
    const img = document.createElement('img'); img.src = item.dataUrl; img.alt = `Generated product image ${index + 1}`;
    const meta = document.createElement('div'); meta.className = 'result-meta';
    const title = document.createElement('span'); title.textContent = `Variation ${index + 1}`;
    const link = document.createElement('a'); link.href = item.dataUrl; link.download = item.filename || `product-${index + 1}.png`; link.textContent = '↓ Download';
    meta.append(title, link); card.append(img, meta); grid.append(card);
  });
}
$('downloadAllBtn').addEventListener('click', async () => {
  for (let i = 0; i < latestImages.length; i++) {
    const a = document.createElement('a'); a.href = latestImages[i].dataUrl; a.download = latestImages[i].filename || `product-${i + 1}.png`; document.body.append(a); a.click(); a.remove();
    await new Promise(resolve => setTimeout(resolve, 250));
  }
});
$('upgradeBtn').addEventListener('click', () => alert('Paid checkout is not connected yet. Before charging users, connect a payment gateway and a verified server-side webhook that updates the Firestore users/{uid} plan and credits. Never grant a paid plan from this button alone.'));
