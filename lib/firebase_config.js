// lib/firebase_config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = { 
  apiKey: "AIzaSyDFKFyo5A9ceBbF07bSydT2x_RDyCLvz1I", 
  authDomain: "prynsc-scribe.firebaseapp.com", 
  projectId: "prynsc-scribe", 
  storageBucket: "prynsc-scribe.firebasestorage.app", 
  messagingSenderId: "997430707291", 
  appId: "1:997430707291:web:449f0b5832ea10a4836b7e", 
  measurementId: "G-C40SEH6LN1" 
}; 

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { 
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs 
};
