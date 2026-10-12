// Replace these placeholders with your Firebase project's Web App config.
// Firebase web config is public by design; never put service-account credentials here.
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
export const firebaseConfig = {
  apiKey: "AIzaSyAzJt4mCfK1_tiDsPhMMpP_9XvxSfuH4i4",
  authDomain: "productstudio-ai-bda7b.firebaseapp.com",
  projectId: "productstudio-ai-bda7b",
  storageBucket: "productstudio-ai-bda7b.firebasestorage.app",
  messagingSenderId: "686068073660",
  appId: "1:686068073660:web:510899f31296acc2927cb9",
  measurementId: "G-QT36HN10L5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
