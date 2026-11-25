# Spinoza Lab

**AI for the air-gapped economy.** Private AI that runs on a company's own hardware, reads its own files, and never sends a byte to the cloud.

Live site: https://xenaarch-dev.github.io/spinoza-lab/
Live console: https://xenaarch-dev.github.io/spinoza-lab/lab.html

## The problem
Enterprises in India (banks, manufacturers, pharma, hospitals, law firms, defence suppliers) want AI but cannot send confidential data to cloud chatbots. The DPDP Rules (notified Nov 2025) put penalties of up to Rs 250 crore on failures to protect personal data. Per-seat AI subscriptions cost over Rs 1 crore a year for 500 employees, and the data still leaves the building.

## The solution
- **Spinoza Box**: a GPU appliance that sits in the company's server room.
- **Spinoza OS**: open-weight models (Llama, Qwen, Gemma, Mistral), private search over company files, daily AI chores.
- **Trust Layer**: egress firewall, PII shield (Aadhaar, PAN, phone, email), role-based access, SHA-256 chained audit ledger.

## The prototype (this repo)
`lab.html` is a working console:
- **In-browser model** via WebLLM + WebGPU. Load once, then switch the Wi-Fi off and it keeps answering.
- **Ollama** engine for models already on the laptop (`set OLLAMA_ORIGINS=*` then `ollama serve`).
- **Demo** engine that answers from the local knowledge base with no model at all.
- Local retrieval over company documents (add your own .txt/.md, read in the browser, never uploaded).
- PII masking before the model sees the prompt, role-based document access, live egress meter from the browser's network log, and a hash-chained audit ledger.

Run locally: `python -m http.server 8000` then open http://localhost:8000/lab.html

## Business model
Spinoza Box (hardware, one-time) + flat yearly licence (unlimited users) + setup and model tuning.

Built by Padmaja Kotoky, B.Tech CSE (AI & Cybersecurity), ATLAS SkillTech University, Mumbai.
