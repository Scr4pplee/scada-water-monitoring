import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyACi7uv9Mbub27Pd4WNej4zfZ2HiI6MIww",
  authDomain: "water-tank-monitor-5d0e0.firebaseapp.com",
  databaseURL: "https://water-tank-monitor-5d0e0-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "water-tank-monitor-5d0e0",
  storageBucket: "water-tank-monitor-5d0e0.firebasestorage.app",
  messagingSenderId: "603528956466",
  appId: "1:603528956466:web:c9b0223f68bcb817be0a2b",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app); // Pastikan ini diekspor
