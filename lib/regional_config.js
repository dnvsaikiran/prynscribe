// lib/regional_config.js

export const REGIONAL_EXAMS = {
    "IN": {
        name: "India",
        flag: "🇮🇳",
        currency: "INR",
        symbol: "₹",
        ppp_price: 299, // Monthly Pro price adjusted for India PPP
        exams: [
            { 
                id: "upsc", label: "UPSC Civil Services", goal: "Bureaucracy & Policy", icon: "🏛️", img: "/assets/icons/policy.png",
                features: ['summary-sheet', 'mindmap', 'mcqs', 'glossary', 'history', 'analysis', 'suggestions', 'consultant', 'verbatim-transcript']
            },
            { 
                id: "jee", label: "IIT-JEE (Advanced)", goal: "Engineering Excellence", icon: "⚙️", img: "/assets/icons/tech.png",
                features: ['summary-sheet', 'mindmap', 'mcqs', 'glossary', 'analysis', 'suggestions', 'verbatim-transcript']
            },
            { 
                id: "neet", label: "NEET-UG", goal: "Medical Specialization", icon: "🩺", img: "/assets/icons/medicine.png",
                features: ['summary-sheet', 'mindmap', 'mcqs', 'glossary', 'analysis', 'suggestions', 'verbatim-transcript']
            },
            { 
                id: "cat", label: "CAT (IIMs)", goal: "Management Strategy", icon: "📈", img: "/assets/icons/business.png",
                features: ['summary-sheet', 'mindmap', 'mcqs', 'analysis', 'suggestions', 'verbatim-transcript']
            },
            { 
                id: "ca", label: "CA (ICAI)", goal: "Financial Auditing", icon: "📊", img: "/assets/icons/business.png",
                features: ['summary-sheet', 'mcqs', 'glossary', 'analysis', 'suggestions', 'verbatim-transcript']
            }
        ]
    },
    "US": {
        name: "United States",
        flag: "🇺🇸",
        currency: "USD",
        symbol: "$",
        ppp_price: 9.99, // Economical student rate (reduced from $19.99 to drive volume)
        exams: [
            { 
                id: "usmle", label: "USMLE (Steps 1/2/3)", goal: "Clinical Residency", icon: "🏥", img: "/assets/icons/medicine.png",
                features: ['summary-sheet', 'mindmap', 'mcqs', 'glossary', 'history', 'analysis', 'suggestions', 'consultant', 'verbatim-transcript']
            },
            { 
                id: "mcat", label: "MCAT", goal: "Medical School Entry", icon: "🧬", img: "/assets/icons/medicine.png",
                features: ['summary-sheet', 'mindmap', 'mcqs', 'glossary', 'analysis', 'suggestions', 'verbatim-transcript']
            },
            { 
                id: "lsat", label: "LSAT", goal: "Law School Admissions", icon: "📚", img: "/assets/icons/law.png",
                features: ['summary-sheet', 'mcqs', 'analysis', 'suggestions', 'verbatim-transcript']
            },
            { 
                id: "bar", label: "The Bar Exam", goal: "Legal Practice", icon: "⚖️", img: "/assets/icons/law.png",
                features: ['summary-sheet', 'mcqs', 'history', 'analysis', 'suggestions', 'verbatim-transcript']
            },
            { 
                id: "cfa", label: "CFA Charter", goal: "Investment Analysis", icon: "💎", img: "/assets/icons/business.png",
                features: ['summary-sheet', 'mindmap', 'mcqs', 'glossary', 'analysis', 'suggestions', 'verbatim-transcript']
            }
        ]
    },
    "UK": {
        name: "United Kingdom",
        flag: "🇬🇧",
        currency: "GBP",
        symbol: "£",
        ppp_price: 7.99, // Economical student rate (reduced from £14.99)
        exams: [
            { 
                id: "plab", label: "PLAB (GMC)", goal: "UK Medical License", icon: "🩺", img: "/assets/icons/medicine.png",
                features: ['summary-sheet', 'mindmap', 'mcqs', 'glossary', 'analysis', 'suggestions', 'verbatim-transcript']
            },
            { 
                id: "sqe", label: "SQE (Law)", goal: "Solicitor Qualification", icon: "🖋️", img: "/assets/icons/law.png",
                features: ['summary-sheet', 'mcqs', 'analysis', 'suggestions', 'verbatim-transcript']
            },
            { 
                id: "oxbridge", label: "Oxbridge Admissions", goal: "Elite Academic Entry", icon: "🎓", img: "/assets/icons/policy.png",
                features: ['summary-sheet', 'mindmap', 'mcqs', 'glossary', 'analysis', 'suggestions', 'verbatim-transcript']
            },
            { 
                id: "acca", label: "ACCA", goal: "Global Accounting", icon: "💸", img: "/assets/icons/business.png",
                features: ['summary-sheet', 'mcqs', 'glossary', 'analysis', 'suggestions', 'verbatim-transcript']
            }
        ]
    },
    "EU": {
        name: "Europe",
        flag: "🇪🇺",
        currency: "EUR",
        symbol: "€",
        ppp_price: 8.99,
        exams: [
            { 
                id: "erf", label: "ERF (Medical)", goal: "European Residency", icon: "🩺", img: "/assets/icons/medicine.png",
                features: ['summary-sheet', 'mindmap', 'mcqs', 'glossary', 'analysis', 'suggestions', 'verbatim-transcript']
            },
            { 
                id: "acca_global", label: "ACCA Global", goal: "European Finance", icon: "📊", img: "/assets/icons/business.png",
                features: ['summary-sheet', 'mcqs', 'glossary', 'analysis', 'suggestions', 'verbatim-transcript']
            },
            { 
                id: "erasmus", label: "Erasmus Entrance", goal: "Exchange Mastery", icon: "🌍", img: "/assets/icons/policy.png",
                features: ['summary-sheet', 'mindmap', 'mcqs', 'glossary', 'analysis', 'suggestions', 'verbatim-transcript']
            }
        ]
    },
    "GLOBAL": {
        name: "Global / Universal",
        flag: "🌐",
        currency: "USD",
        symbol: "$",
        ppp_price: 4.99, // Highly accessible entry price for emerging markets
        exams: [
            { 
                id: "general", label: "General Academic", goal: "Learning", icon: "📖", img: "/assets/icons/policy.png",
                features: ['summary-sheet', 'suggestions', 'verbatim-transcript']
            },
            { 
                id: "podcast", label: "Podcast / Narrative", goal: "Storytelling", icon: "🎙️", img: "/assets/icons/tech.png",
                features: ['summary-sheet', 'suggestions', 'verbatim-transcript']
            },
            { 
                id: "hacker", label: "Hacker / Technical", goal: "Coding & Systems", icon: "💻", img: "/assets/icons/tech.png",
                features: ['summary-sheet', 'analysis', 'suggestions', 'verbatim-transcript']
            }
        ]
    }
};

export function getExamsForCountry(countryCode) {
    return REGIONAL_EXAMS[countryCode]?.exams || REGIONAL_EXAMS["GLOBAL"].exams;
}

export function getPricingForCountry(countryCode) {
    const config = REGIONAL_EXAMS[countryCode] || REGIONAL_EXAMS["GLOBAL"];
    return {
        currency: config.currency,
        symbol: config.symbol,
        price: config.ppp_price
    };
}
