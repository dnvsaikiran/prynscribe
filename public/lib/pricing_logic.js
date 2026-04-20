// public/lib/pricing_logic.js
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

export async function detectUserCountry() {
    try {
        const response = await fetch('https://ipapi.co/json/');
        const data = await response.json();
        return {
            countryCode: data.country_code || 'GLOBAL',
            isIndia: data.country_code === 'IN'
        };
    } catch (e) {
        return { countryCode: 'GLOBAL', isIndia: false };
    }
}

export function getPricing(regionCode) {
    if (regionCode === 'IN') return PRICES.IN;
    return PRICES.GLOBAL;
}

export function formatPrice(pricing) {
    if (pricing.currency === 'INR') {
        return `${pricing.symbol}${pricing.amount / 100}`;
    }
    return `${pricing.symbol}${pricing.amount / 100}`;
}
