// lib/pricing_logic.js

export const PRICES = {
    IN: {
        amount: 29900, // ₹299.00
        currency: 'INR',
        symbol: '₹'
    },
    GLOBAL: {
        amount: 999, // $9.99
        currency: 'USD',
        symbol: '$'
    }
};

/**
 * Detects user country based on IP
 * @returns {Promise<Object>} { countryCode, isIndia }
 */
export async function detectUserCountry() {
    try {
        const response = await fetch('https://ipapi.co/json/');
        const data = await response.json();
        console.log("[Pricing] Detected Country:", data.country_code);
        return {
            countryCode: data.country_code || 'GLOBAL',
            isIndia: data.country_code === 'IN'
        };
    } catch (e) {
        console.warn("[Pricing] Location detection failed, defaulting to GLOBAL:", e);
        return { countryCode: 'GLOBAL', isIndia: false };
    }
}

/**
 * Gets pricing based on region with fallback
 */
export function getPricing(regionCode) {
    if (regionCode === 'IN') return PRICES.IN;
    return PRICES.GLOBAL;
}

/**
 * Formats amount for display
 */
export function formatPrice(pricing) {
    if (pricing.currency === 'INR') {
        return `${pricing.symbol}${pricing.amount / 100}`;
    }
    return `${pricing.symbol}${pricing.amount / 100}`;
}
