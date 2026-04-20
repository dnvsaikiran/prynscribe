// lib/mode_selector_ui.js
// Reusable Mode Selector — renders into any container on web or extension popup.

import { MODE_CONFIG, TIER_LIMITS, calculateLevel, calculateXP } from './synthesis_engine.js';

const CATEGORIES = {
    smart:  { label: "✨ Smart",    modes: ['auto'] },
    learn:  { label: "📖 Learn",    modes: ['summary', 'podcast'] },
    master: { label: "🏆 Master",   modes: ['exam', 'memory', 'problem_solving'] },
    career: { label: "💼 Career",   modes: ['interview', 'productivity'] },
    pro:    { label: "🔭 Pro",      modes: ['notes', 'research'] },
};

const TIER_BADGE = { free: 'FREE', pro: 'PRO', elite: 'ELITE' };
const TIER_COLOR = { free: '#4ade80', pro: 'hsl(252,90%,68%)', elite: 'hsl(45,100%,60%)' };

export class ModeSelectorUI {
    /**
     * @param {HTMLElement} container - Where to render the UI
     * @param {Object} options
     * @param {string} options.userTier - 'free' | 'pro' | 'elite'
     * @param {string} options.selectedMode - current mode key
     * @param {number} options.xp - total XP
     * @param {number} options.streakDays
     * @param {Function} options.onModeSelect - callback(modeKey)
     * @param {Function} options.onUpgrade - callback()
     */
    constructor(container, options = {}) {
        this.container = container;
        this.userTier = options.userTier || 'free';
        this.selectedMode = options.selectedMode || 'auto';
        this.xp = options.xp || 0;
        this.streakDays = options.streakDays || 0;
        this.onModeSelect = options.onModeSelect || (() => {});
        this.onUpgrade = options.onUpgrade || (() => {});
        this._render();
    }

    _canUse(mode) {
        return TIER_LIMITS[this.userTier]?.includes(mode) ?? false;
    }

    _render() {
        const level = calculateLevel(this.xp);
        const xpForCurrentLevel = Math.pow(2, level - 1) * 50;
        const xpForNextLevel = Math.pow(2, level) * 50;
        const xpProgress = Math.round(((this.xp - xpForCurrentLevel) / (xpForNextLevel - xpForCurrentLevel)) * 100);

        let html = `<div class="mode-system">`;

        // XP Bar
        html += `
        <div class="xp-bar-wrap">
            <div class="xp-level-badge">${level}</div>
            <div class="xp-meta">
                <div class="xp-labels">
                    <span class="xp-name">Level ${level} Scholar</span>
                    <span class="xp-count">${this.xp.toLocaleString()} XP</span>
                </div>
                <div class="xp-bar-track">
                    <div class="xp-bar-fill" style="width:${Math.min(xpProgress, 100)}%"></div>
                </div>
            </div>
        </div>`;

        // Streak banner
        if (this.streakDays >= 2) {
            const multiplier = this.streakDays >= 7 ? '1.5×' : this.streakDays >= 3 ? '1.2×' : '';
            html += `
            <div class="streak-banner">
                <span class="streak-fire">🔥</span>
                <div>
                    <div class="streak-count">${this.streakDays} Day Streak</div>
                    <div class="streak-label">${multiplier ? `${multiplier} XP Multiplier Active` : 'Keep it going tomorrow!'}</div>
                </div>
            </div>`;
        }

        // Mode Categories
        for (const [catKey, cat] of Object.entries(CATEGORIES)) {
            html += `<div class="mode-category-label">${cat.label}</div>`;
            html += `<div class="mode-grid">`;
            for (const modeKey of cat.modes) {
                const m = MODE_CONFIG[modeKey];
                if (!m) continue;
                const canUse = this._canUse(modeKey);
                const isActive = this.selectedMode === modeKey;
                const isAuto = modeKey === 'auto';

                let cardClasses = 'mode-card';
                if (isActive) cardClasses += ' active';
                if (!canUse) cardClasses += ' locked';
                if (isAuto) cardClasses += ' auto-mode';

                html += `
                <div class="${cardClasses}"
                     style="--card-accent-color: ${m.accent}"
                     data-mode="${modeKey}"
                     id="mode-card-${modeKey}"
                     ${!canUse ? 'aria-disabled="true"' : ''}>
                    ${isAuto ? '<div class="mode-auto-badge">AI PICKS</div>' : ''}
                    ${!canUse ? `<div class="lock-badge">${TIER_BADGE[m.tier]} 🔒</div>` : ''}
                    <span class="mode-emoji">${m.emoji}</span>
                    <div class="mode-label">${m.label}</div>
                    <div class="mode-tagline">${m.tagline}</div>
                </div>`;
            }
            html += `</div>`;
        }

        // Upgrade CTA for non-elite
        if (this.userTier !== 'elite') {
            const nextTier = this.userTier === 'free' ? 'Pro' : 'Elite';
            const lockedCount = Object.keys(MODE_CONFIG).filter(m => !this._canUse(m)).length;
            html += `
            <div class="tier-cta">
                <div class="tier-cta-title">Unlock ${lockedCount} More Modes</div>
                <div class="tier-cta-sub">Upgrade to ${nextTier} to access Exam, Research, Interview & more.</div>
                <button class="tier-cta-btn" id="mode-upgrade-btn">UPGRADE TO ${nextTier.toUpperCase()} →</button>
            </div>`;
        }

        html += `</div>`; // end .mode-system
        this.container.innerHTML = html;
        this._attachEvents();
    }

    _attachEvents() {
        // Mode card clicks
        this.container.querySelectorAll('.mode-card:not(.locked)').forEach(card => {
            card.addEventListener('click', () => {
                const mode = card.dataset.mode;
                this.selectedMode = mode;
                this._updateActiveState();
                this.onModeSelect(mode);
            });
        });

        // Upgrade CTA
        const upgradeBtn = this.container.querySelector('#mode-upgrade-btn');
        if (upgradeBtn) upgradeBtn.addEventListener('click', this.onUpgrade);
    }

    _updateActiveState() {
        this.container.querySelectorAll('.mode-card').forEach(card => {
            card.classList.toggle('active', card.dataset.mode === this.selectedMode);
        });
    }

    // Call this to update XP without re-rendering
    updateXP(xp, streakDays) {
        this.xp = xp;
        this.streakDays = streakDays;
        this._render();
    }
}
