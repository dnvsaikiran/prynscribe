import { supabase } from './supabase_bundle.js';

let currentConfig = null;

/**
 * MASTER CONFIGURATION: Fetches the global configuration from Firestore.
 * This includes regions, pricing, exams, and active modes.
 */
export async function getGlobalConfig() {
    if (currentConfig) return currentConfig;
    
    try {
        const { data, error } = await supabase
            .from('configs')
            .select('*')
            .eq('id', 'global')
            .single();
            
        if (data && !error) {
            currentConfig = data.config_data;
            return currentConfig;
        }
    } catch (e) {
        console.error("[Config] Failed to fetch global config from Supabase:", e);
    }
    
    // Fallback to basic structure if Firestore fails
    return {
        regions: {
            "IN": { name: "India", flag: "🇮🇳", currency: "INR", symbol: "₹" },
            "US": { name: "United States", flag: "🇺🇸", currency: "USD", symbol: "$" },
            "EU": { name: "Europe", flag: "🇪🇺", currency: "EUR", symbol: "€" }
        },
        modes: ["podcast", "review", "normal"]
    };
}

/**
 * REAL-TIME SYNC: Listens for changes in the admin panel and updates the UI.
 */
export function subscribeToConfig(callback) {
    return supabase
        .channel('public:configs')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'configs', filter: 'id=eq.global' }, payload => {
            currentConfig = payload.new.config_data;
            callback(currentConfig);
        })
        .subscribe();
}
