'use strict';
/**
 * Presentation copy for structured help pages (FAQ + size charts).
 * Page prose itself comes from Shopify pages (lib/shopify/catalog); these
 * tables are the storefront's own layout content, mirrored in the OS 2.0
 * theme's FAQ/size sections.
 */
const FAQ_DEFS = [
  {
    "q": "When will my order ship?",
    "a": "Orders placed before 2pm ET ship the same business day from our Brooklyn warehouse. You will get a tracking link by email the moment the label scans.",
    "group": "Shipping"
  },
  {
    "q": "How do returns work?",
    "a": "You have 30 days from delivery. Start a return from your account order history and we email a prepaid label the same day. Refunds hit your original payment method within 3–5 business days of arrival.",
    "group": "Shipping"
  },
  {
    "q": "Do you ship internationally?",
    "a": "Yes. Canada and the UK ship duties-prepaid (DDP). Elsewhere, duties and taxes are shown at checkout so there are no surprise fees at the door.",
    "group": "Shipping"
  },
  {
    "q": "What if I am between sizes?",
    "a": "Size up for layers, size down for compression pieces like the Flow Legging. Every product page carries a fit note from the product team, and exchanges are always free.",
    "group": "Sizing"
  },
  {
    "q": "How should I wash technical pieces?",
    "a": "Cold wash with like colours, no fabric softener (it clogs the wicking channels), and hang dry where you can. Details are on the care label inside every garment.",
    "group": "Sizing"
  },
  {
    "q": "What payment methods do you take?",
    "a": "All major cards, Shop Pay, Apple Pay, Google Pay and Vennix gift cards. We also offer 4 interest-free payments through Shop Pay Installments on orders over $50.",
    "group": "Payment"
  },
  {
    "q": "Is my payment information safe?",
    "a": "Yes. Card details are tokenised by our payment provider and never touch our servers. We are PCI-DSS SAQ-A compliant and every connection is TLS 1.3.",
    "group": "Payment"
  },
  {
    "q": "Do you really repair garments?",
    "a": "We do. Two years of free repairs on seams, zips and elastics. Email repairs@vennixstore.com with a photo and your order number.",
    "group": "Product"
  },
  {
    "q": "How do I track my order?",
    "a": "Use the tracking link in your shipping email, or enter your order number and email on our track order page. No account needed.",
    "group": "Product"
  }
];

const SIZE_CHARTS = {
  "tops": {
    "label": "Tops, jackets & hoodies",
    "columns": [
      "Size",
      "Chest (in)",
      "Chest (cm)",
      "Body length (in)",
      "Sleeve (in)"
    ],
    "rows": [
      [
        "XS",
        "34–36",
        "86–91",
        "26.5",
        "32"
      ],
      [
        "S",
        "36–38",
        "91–97",
        "27.5",
        "33"
      ],
      [
        "M",
        "38–40",
        "97–102",
        "28.5",
        "34"
      ],
      [
        "L",
        "40–42.5",
        "102–108",
        "29.5",
        "35"
      ],
      [
        "XL",
        "42.5–45",
        "108–114",
        "30.5",
        "36"
      ],
      [
        "XXL",
        "45–48",
        "114–122",
        "31.5",
        "37"
      ]
    ]
  },
  "bottoms": {
    "label": "Joggers, shorts & leggings",
    "columns": [
      "Size",
      "Waist (in)",
      "Waist (cm)",
      "Hip (in)",
      "Inseam (in)"
    ],
    "rows": [
      [
        "XS",
        "26–28",
        "66–71",
        "34–36",
        "27"
      ],
      [
        "S",
        "28–30",
        "71–76",
        "36–38",
        "28"
      ],
      [
        "M",
        "30–32",
        "76–81",
        "38–40",
        "29"
      ],
      [
        "L",
        "32–34.5",
        "81–88",
        "40–42",
        "30"
      ],
      [
        "XL",
        "34.5–37",
        "88–94",
        "42–44",
        "31"
      ],
      [
        "XXL",
        "37–40",
        "94–102",
        "44–46",
        "32"
      ]
    ]
  }
};

module.exports = { FAQ_DEFS, SIZE_CHARTS };
