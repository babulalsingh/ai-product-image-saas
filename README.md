# ProductStudio AI — Product Image Generator MVP

A responsive HTML/CSS/JavaScript frontend and Node.js/Express backend scaffold for product-photo-to-image generation.

## Included
- Firebase Email/Password authentication
- Server-side Firebase ID-token verification
- Product photo upload (JPG/PNG/WEBP, max 10 MB)
- Prompt, Amazon/Etsy/Luxury/Lifestyle/Infographic/Social templates
- Aspect ratio selector and 1–4 images per request
- OpenAI image edit API integration
- Download each generated image or all generated images
- Firestore credits and plan enforcement; free users cannot request 2K/4K
- Rate limiting, Helmet security headers, upload validation
- Example Firestore rules denying direct client access

## Requirements
- Node.js 20+
- Firebase project with Authentication Email/Password enabled and Firestore created
- Firebase Admin service account credentials for local development
- OpenAI API key and API billing/permissions enabled

## Local setup
1. Install Node.js 20 or newer.
2. In Firebase Console, create a Web App and enable **Authentication → Sign-in method → Email/Password**.
3. Copy the Firebase web config into `public/firebase-config.js`.
4. Create a Firebase service account and save its JSON as `service-account.json` in this folder. Do not commit/share it. Alternatively configure Application Default Credentials.
5. Copy `.env.example` to `.env`, add `OPENAI_API_KEY`, and set `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json`.
6. Run:
   ```bash
   npm install
   npm start
   ```
7. Open http://localhost:3000.
8. Create an account, upload a product photo and generate images.

## Important billing/production notes
- The backend creates a new account with 20 starter credits. This is a prototype policy; adjust it before public launch and add abuse prevention/email verification.
- A generation costs 1 credit per image for 720p/1080p, 2 per image for 2K, and 4 per image for 4K. The backend rejects 2K/4K for Free users. Only a trusted payment webhook/admin process should change `users/{uid}.plan` and credits.
- The payment button is deliberately a placeholder. No payment gateway or verified webhook is included; do not sell subscriptions until that is implemented.
- Image API providers have a limited set of native sizes. The selected 1080p setting maps to a supported size and does **not** guarantee exact 1920×1080 pixels. Exact 2K/4K requires an upscaling service and a final dimension check. Aspect ratios may be approximated by the provider's supported native sizes.
- Generated image bytes are returned to the browser for download; they are not stored permanently. History stores job metadata only.
- Do not put API keys, service-account JSON, or payment secrets in the `public` folder or frontend JavaScript.
- Before launch, add verified payment webhooks, email verification, stronger abuse controls, privacy/retention policy, production hosting, error monitoring, and tests.

## Granting a paid plan for development only
Use Firebase Console or a trusted admin script to set `users/{uid}` fields, for example `{ plan: "pro", credits: 500 }`. Never expose an endpoint that lets a user choose their own plan. In production, update these fields only after validating payment provider webhooks.
