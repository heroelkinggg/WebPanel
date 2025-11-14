import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";

// Security: Validate Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyBW-wYAUqxkAHnfdU1ZdKr2vDcrlB9wJu0",
    authDomain: "xhero-panel.firebaseapp.com",
    databaseURL: "https://xhero-panel-default-rtdb.firebaseio.com",
    projectId: "xhero-panel",
    storageBucket: "xhero-panel.appspot.com",
    messagingSenderId: "884739188583",
    appId: "1:884739188583:web:0694c48bf1a3e7639d31c2",
    measurementId: "G-YY1PT87HYE"
};

// Validate config before initializing
if (!firebaseConfig.apiKey || !firebaseConfig.authDomain) {
    console.error('Invalid Firebase configuration');
    throw new Error('Firebase configuration error');
}

// Initialize Firebase app and auth
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Input validation helpers
function validateEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
    return emailRegex.test(email) && email.length <= 254;
}

function validatePassword(password) {
    if (!password || typeof password !== 'string') return false;
    return password.length >= 6 && password.length <= 128;
}

function sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>]/g, '').trim();
}

// Initialize authentication state
onAuthStateChanged(auth, (user) => {
    const loginView = document.getElementById('login-view');
    const panelView = document.getElementById('panel-view');
    
    if (user) {
        // User is authenticated - show panel
        if (loginView) loginView.style.display = 'none';
        if (panelView) panelView.style.display = 'flex';
    } else {
        // User is not authenticated - show login
        if (loginView) loginView.style.display = 'flex';
        if (panelView) panelView.style.display = 'none';
    }
});

// Login form handler
const loginForm = document.getElementById('login-form');
if (loginForm) {
    const errorElement = document.getElementById('login-error');
    let isSubmitting = false;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Prevent double submission
        if (isSubmitting) return;
        isSubmitting = true;

        // Rate limiting check
        const rateLimitCheck = window.checkRateLimit ? window.checkRateLimit() : { allowed: true };
        if (!rateLimitCheck.allowed) {
            errorElement.textContent = rateLimitCheck.message;
            isSubmitting = false;
            return;
        }

        // Get and validate inputs
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');
        const rememberMe = document.getElementById('login-remember')?.checked || false;

        if (!emailInput || !passwordInput) {
            errorElement.textContent = 'Form error. Please refresh the page.';
            isSubmitting = false;
            return;
        }

        const email = sanitizeString(emailInput.value);
        const password = passwordInput.value; // Don't sanitize password

        // Validate inputs
        if (!validateEmail(email)) {
            errorElement.textContent = 'Please enter a valid email address.';
            isSubmitting = false;
            return;
        }

        if (!validatePassword(password)) {
            errorElement.textContent = 'Password must be between 6 and 128 characters.';
            isSubmitting = false;
            return;
        }

        try {
            // Set persistence based on remember me checkbox
            await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
            
            // Attempt login
            await signInWithEmailAndPassword(auth, email, password);
            
            // Success - record attempt
            if (window.recordLoginAttempt) {
                window.recordLoginAttempt(true);
            }
            
            // Clear form
            emailInput.value = '';
            passwordInput.value = '';
            errorElement.textContent = '';
            
        } catch (error) {
            // Record failed attempt
            if (window.recordLoginAttempt) {
                window.recordLoginAttempt(false);
            }
            
            // Generic error message to prevent user enumeration
            errorElement.textContent = 'Invalid email or password.';
            console.error('Login error:', error.code);
        } finally {
            isSubmitting = false;
        }
    });
}

// Register form handler (if exists)
const registerForm = document.getElementById('register-form');
if (registerForm) {
    const errorElement = document.getElementById('register-error');
    
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');

        if (!emailInput || !passwordInput) {
            if (errorElement) errorElement.textContent = 'Form error. Please refresh the page.';
            return;
        }

        const email = sanitizeString(emailInput.value);
        const password = passwordInput.value;

        // Validate inputs
        if (!validateEmail(email)) {
            if (errorElement) errorElement.textContent = 'Please enter a valid email address.';
            return;
        }

        if (!validatePassword(password)) {
            if (errorElement) errorElement.textContent = 'Password must be between 6 and 128 characters.';
            return;
        }

        try {
            await createUserWithEmailAndPassword(auth, email, password);
            // Success - form will be cleared by auth state change
        } catch (error) {
            if (errorElement) {
                if (error.code === 'auth/email-already-in-use') {
                    errorElement.textContent = 'This email is already in use.';
                } else {
                    errorElement.textContent = 'Error creating account. Please try again.';
                }
            }
            console.error('Registration error:', error.code);
        }
    });
}
