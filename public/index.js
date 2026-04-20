// index.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { detectUserCountry, getPricing, formatPrice } from "./lib/pricing_logic.js";
import { ModeSelectorUI } from "./lib/mode_selector_ui.js";
import { calculateLevel, calculateXP, MODE_CONFIG } from "./lib/synthesis_engine.js";
import { SUPPORTED_LANGUAGES, getLangLabel, getLangFlag } from "./lib/language_config.js";

const SUPABASE_URL = "https://unamoikkxjwdiyjetbyn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuYW1vaWtreGp3ZGl5amV0YnluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2Nzc2MDcsImV4cCI6MjA5MjI1MzYwN30.wPh02GPlnLeL__qqmX95PQDLPKh9LEBuvKow6P2uq88";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// DOM Elements
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const libraryBtn = document.getElementById('library-btn');
const authSection = document.getElementById('auth-section');
const userSection = document.getElementById('user-section');
const authLoading = document.getElementById('auth-loading');
const payBtn = document.getElementById('pay-btn');
const proPriceDisplay = document.getElementById('pro-price-display');

// Onboarding Elements
const onboardingOverlay = document.getElementById('onboarding-overlay');
const stepGoal = document.getElementById('step-goal');
const stepPath = document.getElementById('step-path');
const stepLocation = document.getElementById('step-location');
const stepSuccess = document.getElementById('step-success');
const pathOptionsContainer = document.getElementById('path-options');
const confirmOnboardingBtn = document.getElementById('confirm-onboarding-btn');
const finalStartBtn = document.getElementById('final-start-btn');
const regionOverrideBtn = document.getElementById('region-override');
const countrySelector = document.getElementById('country-selector');

// Dashboard Elements
const userNameTitle = document.getElementById('user-name-title');
const userPlanBadge = document.getElementById('user-plan-badge');
const quotaValue = document.getElementById('quota-value');
const quotaProgress = document.getElementById('quota-progress');
const syncValue = document.getElementById('sync-value');
const changePathBtn = document.getElementById('change-path-btn');
const globalSynthesisCount = document.getElementById('global-synthesis-count');
const userSynthesisCount = document.getElementById('user-synthesis-count');
const headerUserBadge = document.getElementById('header-user-badge');
const headerUserName = document.getElementById('header-user-name');
const headerUserPlan = document.getElementById('header-user-plan');
const examPersonaIcon = document.getElementById('exam-persona-icon');

// Local State
let onboardingData = { goal: null, path: null, region: 'GLOBAL' };
let globalConfig = null;
// The Extension ID must match the one in your chrome://extensions page when loaded unpacked.
// Fallback: This can be passed via URL parameter if the dashboard is hosted.
const urlParams = new URLSearchParams(window.location.search);
const EXTENSION_ID = urlParams.get('extId') || "chjbgploaecdbloapphmbidioenjklko"; 

async function loadConfig() {
    try {
        const res = await fetch('./lib/onboarding_config.json');
        globalConfig = await res.json();
    } catch (e) { console.warn("[Web] Config failed, using fallback."); }
}

const MASCOT_MAPPING = {
    // Competitive
    'UPSC': 'policy.png',
    'JEE': 'tech.png',
    'NEET': 'medicine.png',
    'GATE': 'tech.png',
    'UPSC (IAS)': 'policy.png',
    // University
    'MCAT': 'medicine.png',
    'LSAT': 'law.png',
    'LNAT': 'law.png',
    // Professional
    'CA': 'business.png',
    'MBA': 'business.png',
    'CFA': 'business.png',
    'CPA': 'business.png',
    'GENERAL': 'business.png',
    // Default
    'default': 'business.png'
};

function getMascotForPath(path) {
    if (!path) return MASCOT_MAPPING.default;
    // Try exact match or partial (UPSC (IAS) matches UPSC)
    for (const key in MASCOT_MAPPING) {
        if (path.toUpperCase().includes(key)) return MASCOT_MAPPING[key];
    }
    return MASCOT_MAPPING.default;
}

async function syncToExtension(profile) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(EXTENSION_ID, { type: 'AUTH_SYNC', profile }, (response) => {
            if (chrome.runtime.lastError) console.log("[Sync] Extension node currently disconnected.");
        });
    }
}

async function initAuth() {
    await loadConfig();
    const location = await detectUserCountry();
    onboardingData.region = location.isIndia ? 'IN' : 'GLOBAL';
    updatePricingUI(onboardingData.region);

    supabase.auth.onAuthStateChange(async (event, session) => {
        if (authLoading) authLoading.style.display = 'none';
        const user = session?.user;
        if (user) {
            authSection.style.display = 'none';
            userSection.style.display = 'flex';
            
            const { data: userSnap } = await supabase.from('profiles').select('*').eq('id', user.id).single();
            if (!userSnap || !userSnap.onboarding_complete) {
                showOnboarding(location.countryCode);
            } else {
                const data = userSnap;
                renderDashboard({
                    isPremium: data.is_premium,
                    tier: data.tier || (data.is_premium ? 'pro' : 'free'),
                    balance_seconds: data.balance_seconds,
                    recordings_count: data.recordings_count,
                    examPath: data.exam_path,
                    goal: data.goal,
                    region: data.region,
                    // Growth system
                    xp: data.xp || 0,
                    level: data.level || 1,
                    streak_days: data.streak_days || 0,
                    selected_mode: data.selected_mode || 'auto',
                    // Language
                    preferred_output_language: data.preferred_output_language || 'en',
                }, { displayName: data.display_name, email: user.email });
                
                const jwt = session.access_token;
                syncToExtension({
                    uid: user.id,
                    email: user.email,
                    idToken: jwt,
                    displayName: data.display_name,
                    isPremium: data.is_premium || false,
                    tier: data.tier || 'free',
                    goal: data.goal,
                    path: data.exam_path,
                    region: data.region || 'GLOBAL',
                    xp: data.xp || 0,
                    streak_days: data.streak_days || 0,
                    selected_mode: data.selected_mode || 'auto',
                });
            }
        } else {
            authSection.style.display = 'block';
            userSection.style.display = 'none';
            if (headerUserBadge) headerUserBadge.style.display = 'none';
        }
    });
}

function renderDashboard(data, user) {
    const name = user.displayName || user.email.split('@')[0];
    const formattedName = name.toUpperCase();
    if (userNameTitle) userNameTitle.textContent = `Hi, ${formattedName}.`;
    if (headerUserName) headerUserName.textContent = formattedName;
    
    const isPremium = data.isPremium || false;
    if (userPlanBadge) {
        userPlanBadge.textContent = isPremium ? 'ELITE PLAN' : 'FREE TIER';
        userPlanBadge.className = `badge-pill ${isPremium ? 'premium' : ''}`;
    }
    if (headerUserPlan) headerUserPlan.textContent = isPremium ? 'ELITE' : 'FREE';
    if (headerUserBadge) headerUserBadge.style.display = 'flex';

    // Mascot & Path
    const mascot = getMascotForPath(data.examPath);
    if (examPersonaIcon) examPersonaIcon.src = `assets/icons/${mascot}`;
    if (changePathBtn) changePathBtn.textContent = `GOAL: ${(data.examPath || 'GENERAL').toUpperCase()}`;

    // Quota
    let balanceSec = data.balance_seconds;
    if (balanceSec === undefined) balanceSec = 7200;
    if (!isPremium) {
        const remainingLectures = Math.max(0, 2 - (data.recordings_count || 0));
        if (quotaValue) quotaValue.textContent = `${remainingLectures} Sessions Left`;
        if (quotaProgress) quotaProgress.style.width = `${(remainingLectures / 2) * 100}%`;
    } else {
        const hours = Math.floor(balanceSec / 3600);
        const mins = Math.floor((balanceSec % 3600) / 60);
        if (quotaValue) quotaValue.textContent = `${hours}h ${mins}m Left`;
        if (quotaProgress) quotaProgress.style.width = `${Math.min(100, (balanceSec / (30 * 3600)) * 100)}%`;
    }

    // Impact
    if (userSynthesisCount) {
        const pages = (data.recordings_count || 0) * 18;
        userSynthesisCount.textContent = `${pages.toLocaleString()} PAGES`;
    }

    // XP & Level
    const xp = data.xp || 0;
    const level = calculateLevel(xp);
    const xpForCurrent = Math.pow(2, level - 1) * 50;
    const xpForNext = Math.pow(2, level) * 50;
    const xpProgress = Math.min(100, Math.round(((xp - xpForCurrent) / (xpForNext - xpForCurrent)) * 100));

    const xpLevelBadge = document.getElementById('xp-level-badge');
    const xpLevelLabel = document.getElementById('xp-level-label');
    const xpTotal = document.getElementById('xp-total');
    const xpBarFill = document.getElementById('xp-bar-fill');
    const xpNext = document.getElementById('xp-next');
    if (xpLevelBadge) xpLevelBadge.textContent = level;
    if (xpLevelLabel) xpLevelLabel.textContent = level;
    if (xpTotal) xpTotal.textContent = xp.toLocaleString();
    if (xpBarFill) setTimeout(() => { xpBarFill.style.width = `${xpProgress}%`; }, 300);
    if (xpNext) xpNext.textContent = (xpForNext - xp).toLocaleString();

    // Streak
    const streakDays = data.streak_days || 0;
    const streakBadge = document.getElementById('streak-badge');
    const streakCount = document.getElementById('streak-count');
    if (streakBadge && streakDays >= 2) {
        streakBadge.style.display = 'inline-flex';
        if (streakCount) streakCount.textContent = streakDays;
    }

    // Global Pulse — update all counters
    const pulseVal = `${(1240402 + (Math.floor(Date.now()/5000)%1000)).toLocaleString()} PAGES`;
    const globalCounter = document.getElementById('global-synthesis-count');
    const dashCounter = document.getElementById('dash-global-count');
    if (globalCounter) globalCounter.textContent = pulseVal;
    if (dashCounter) dashCounter.textContent = pulseVal;

    renderHeatmap();
    
    // Init growth dashboard panels (mode selector + language)
    initModeSelector(data, user);
    initLanguagePanel(data);
}

/**
 * v29: Activity Heatmap Generation
 */
function renderHeatmap() {
    const container = document.getElementById('activity-heatmap');
    if (!container) return;
    container.innerHTML = '';
    
    // Generate 52 weeks * 1 columns (simplified for narrow grid)
    for (let i = 0; i < 52; i++) {
        const col = document.createElement('div');
        col.style.display = 'grid';
        col.style.gridTemplateRows = 'repeat(7, 1fr)';
        col.style.gap = '2px';
        
        for (let j = 0; j < 7; j++) {
            const cell = document.createElement('div');
            cell.style.borderRadius = '1px';
            // Cinematic mock data: slightly more intensity towards the present
            const weight = (i / 52) * Math.random();
            const opacity = weight > 0.6 ? 0.8 : (weight > 0.3 ? 0.3 : 0.05);
            cell.style.background = `var(--accent)`;
            cell.style.opacity = opacity;
            col.appendChild(cell);
        }
        container.appendChild(col);
    }
}

function showOnboarding(detectedCode) {
    onboardingOverlay.classList.add('active');
    
    // Sync current region to the state
    onboardingData.region = (detectedCode === 'IN') ? 'IN' : 'GLOBAL';
    
    // Immediate UI Update
    const chip = document.getElementById('detected-country-chip');
    const name = document.getElementById('detected-country-name');
    if (chip) chip.textContent = detectedCode;
    
    if (name) {
        const regionObj = globalConfig?.regions?.find(r => r.id === (onboardingData.region === 'IN' ? 'IN' : 'GLOBAL'));
        name.textContent = regionObj?.name || (onboardingData.region === 'IN' ? 'India' : 'International / Other');
    }
}

document.querySelectorAll('.option-btn[data-goal]').forEach(btn => {
    btn.onclick = () => {
        onboardingData.goal = btn.dataset.goal;
        renderPaths();
        switchStep(stepGoal, stepPath);
    };
});

function renderPaths() {
    pathOptionsContainer.innerHTML = '';
    const region = onboardingData.region === 'IN' ? 'IN' : 'GLOBAL';
    const paths = globalConfig.paths[region][onboardingData.goal] || [];
    paths.forEach(path => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.innerHTML = `<span class="option-name">${path}</span>`;
        btn.onclick = () => { onboardingData.path = path; switchStep(stepPath, stepLocation); };
        pathOptionsContainer.appendChild(btn);
    });
}

function switchStep(from, to) {
    // Force hide ALL steps to avoid header stacking
    document.querySelectorAll('.onboarding-step').forEach(s => s.classList.remove('active'));
    setTimeout(() => {
        if (to) to.classList.add('active');
    }, 50);
}

confirmOnboardingBtn.onclick = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('profiles').upsert({
        id: user.id,
        onboarding_complete: true,
        goal: onboardingData.goal,
        exam_path: onboardingData.path,
        region: onboardingData.region,
        balance_seconds: 7200, // 2 hours free
        recordings_count: 0
    });
    switchStep(stepLocation, stepSuccess);
};

finalStartBtn.onclick = () => location.reload();

payBtn.onclick = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const pricing = getPricing(onboardingData.region);
    
    payBtn.disabled = true;
    payBtn.innerText = "INITIALIZING...";

    const EDGE_BASE = "https://unamoikkxjwdiyjetbyn.supabase.co/functions/v1/razorpay";
    const jwt = session.access_token;

    try {
        // 1. Create secure order via Supabase Edge Function
        const response = await fetch(`${EDGE_BASE}?action=create-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwt}`
            },
            body: JSON.stringify({
                amount: pricing.amount,
                currency: pricing.currency,
                receipt: `rcpt_${session.user.id.substring(0,8)}_${Date.now()}`
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to create order');
        }

        const orderData = await response.json();

        // 2. Open Standard Checkout
        const options = {
            key: orderData.key_id,
            amount: orderData.amount,
            currency: orderData.currency,
            name: "PrynScribe Elite",
            description: "Unlimited Enterprise Neural Capture",
            order_id: orderData.order_id,
            handler: async (paymentResponse) => {
                payBtn.innerText = "VERIFYING...";
                try {
                    const verifyRes = await fetch(`${EDGE_BASE}?action=verify-payment`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${jwt}`
                        },
                        body: JSON.stringify({
                            razorpay_payment_id: paymentResponse.razorpay_payment_id,
                            razorpay_order_id: paymentResponse.razorpay_order_id,
                            razorpay_signature: paymentResponse.razorpay_signature
                        })
                    });

                    if (verifyRes.ok) {
                        location.reload();
                    } else {
                        const err = await verifyRes.json();
                        alert("Payment verification failed: " + err.message);
                        payBtn.innerText = "UPGRADE TO ELITE";
                        payBtn.disabled = false;
                    }
                } catch (verifyErr) {
                    alert("Network error during verification. Please contact support.");
                    console.error(verifyErr);
                }
            },
            prefill: {
                name: session.user.user_metadata?.full_name || "",
                email: session.user.email || ""
            },
            theme: { color: "#6366f1" }
        };
        
        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', (response) => {
            alert("Payment failed: " + response.error.description);
            payBtn.innerText = "UPGRADE TO ELITE";
            payBtn.disabled = false;
        });
        rzp.on('modal.closed', () => {
            payBtn.innerText = "UPGRADE TO ELITE";
            payBtn.disabled = false;
        });
        rzp.open();
        
    } catch (e) {
        alert("Checkout failed: " + e.message);
        console.error(e);
        payBtn.innerText = "UPGRADE TO ELITE";
        payBtn.disabled = false;
    }
};

loginBtn.onclick = () => supabase.auth.signInWithOAuth({ provider: 'google' });
logoutBtn.onclick = () => supabase.auth.signOut();
changePathBtn.onclick = () => showOnboarding('IN');
if (libraryBtn) libraryBtn.onclick = () => window.location.href = '/pages/library.html';

function updatePricingUI(region) {
    const pricing = getPricing(region);
    if (proPriceDisplay) proPriceDisplay.innerHTML = `${formatPrice(pricing)}<span style="font-size:16px; opacity:0.4;">/mo</span>`;
}

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'PRYNSCRIBE_PULSE') {
        const bars = document.querySelectorAll('#web-visualizer .bar');
        const visualizer = document.getElementById('web-visualizer');
        if (visualizer) visualizer.style.display = 'flex';
        bars.forEach((bar, i) => {
            const dist = Math.abs(i - 6.5) / 6.5;
            const factor = 1 - (dist * 0.7);
            const h = Math.min(100, Math.max(10, event.data.level * factor * 1.5));
            bar.style.height = `${h}%`;
        });
        clearTimeout(window.pulseTimeout);
        window.pulseTimeout = setTimeout(() => { if (visualizer) visualizer.style.display = 'none'; }, 2000);
    }
});

// ── NODE HEARTBEAT ──────────────────────────────────────────────────────────
function initNodeHeartbeat() {
    const statusVal = document.getElementById('sync-value');
    if (!statusVal) return;
    setInterval(async () => {
        try {
            const start = Date.now();
            await supabase.from('profiles').select('id').limit(1);
            const latency = Date.now() - start;
            const color = latency > 800 ? '#fbbf24' : '#4ade80';
            const status = latency > 800 ? 'Degraded' : 'Online';
            statusVal.innerHTML = `<span style="color: ${color};">●</span> Neural Node: ${status} (${latency}ms)`;
        } catch (e) {
            statusVal.innerHTML = `<span style="color: #ef4444;">●</span> Node Offline`;
        }
    }, 15000);
}

// ── MODE SELECTOR ON DASHBOARD ──────────────────────────────────────────────
let _dashModeSelector = null;
function initModeSelector(profileData, _user) {
    const root = document.getElementById('dash-mode-selector-root');
    if (!root) return;

    const userTier = profileData.tier || (profileData.isPremium ? 'pro' : 'free');
    const selectedMode = profileData.selected_mode || 'auto';
    const xp = profileData.xp || 0;
    const streakDays = profileData.streak_days || 0;

    _dashModeSelector = new ModeSelectorUI(root, {
        userTier,
        selectedMode,
        xp,
        streakDays,
        onModeSelect: async (mode) => {
            // Update active mode display
            const cfg = MODE_CONFIG[mode];
            const emojiEl = document.getElementById('dash-mode-emoji');
            const labelEl = document.getElementById('dash-mode-label');
            if (emojiEl) emojiEl.textContent = cfg?.emoji || '✨';
            if (labelEl) labelEl.textContent = cfg?.label || 'Auto Mode';

            // Persist to Supabase
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                await supabase.from('profiles').update({ selected_mode: mode }).eq('id', user.id);
            }
        },
        onUpgrade: () => {
            if (payBtn) payBtn.click();
        }
    });

    // Set active mode display
    const cfg = MODE_CONFIG[selectedMode];
    const emojiEl = document.getElementById('dash-mode-emoji');
    const labelEl = document.getElementById('dash-mode-label');
    if (emojiEl && cfg) emojiEl.textContent = cfg.emoji;
    if (labelEl && cfg) labelEl.textContent = cfg.label;
}

// ── LANGUAGE PANEL ─────────────────────────────────────────────────────────
function initLanguagePanel(profileData) {
    const selectEl = document.getElementById('dash-output-lang-select');
    const saveBtn = document.getElementById('dash-save-lang-btn');
    const lockMsg = document.getElementById('dash-lang-locked');
    const outputDisplay = document.getElementById('dash-output-lang');

    const userTier = profileData.tier || (profileData.isPremium ? 'pro' : 'free');
    const savedLang = profileData.preferred_output_language || 'en';
    const isFree = userTier === 'free';

    if (selectEl) {
        selectEl.value = savedLang;
        if (isFree) {
            selectEl.disabled = true;
            selectEl.style.opacity = '0.4';
            if (lockMsg) lockMsg.style.display = 'inline';
            if (saveBtn) saveBtn.style.display = 'none';
        } else {
            // Update the display label
            selectEl.addEventListener('change', () => {
                const code = selectEl.value;
                if (outputDisplay) outputDisplay.textContent = `${getLangFlag(code)} ${getLangLabel(code)} Output`;
            });
        }
    }

    // Set initial display
    if (outputDisplay) {
        outputDisplay.textContent = `${getLangFlag(savedLang)} ${getLangLabel(savedLang)} Output`;
    }

    // Save button
    if (saveBtn && !isFree) {
        saveBtn.addEventListener('click', async () => {
            const newLang = selectEl?.value || 'en';
            saveBtn.textContent = 'SAVING...';
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                await supabase.from('profiles').update({ preferred_output_language: newLang }).eq('id', user.id);
            }
            saveBtn.textContent = 'SAVED ✓';
            setTimeout(() => { saveBtn.textContent = 'SAVE'; }, 2000);
        });
    }
}

// ── BOOT ────────────────────────────────────────────────────────────────────
initAuth();
initNodeHeartbeat();
