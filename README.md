# Providence — Network Security Intelligence Platform

> *Foresight. Detection. Protection.*

Providence is a multi-component network security platform providing real-time intrusion detection, attack classification, automated response, and adversarial AI detection.

## Components

| Component | Codename | Tech |
|---|---|---|
| Local Agent | The Eye | C++ (libpcap) + Python (ML) |
| Cloud Agent | The Oracle | Python (boto3/AWS SDK) |
| Backend API | The Citadel | Java (Spring Boot) |
| Dashboard | The Lens | TypeScript (React) |
| Browser Extension | The Ward | TypeScript (Chrome Extension) |
| Honeypot Fleet | The Lure | Terraform + AWS EC2 |

## Status

🟢 **The Lure** — Live. Collecting attack data across AWS regions.  
⬜ The Eye — Phase 1 (planned)  
⬜ The Citadel — Phase 2 (planned)  
⬜ ML Pipeline — Phase 3 (planned)  
⬜ Response Engine — Phase 4 (planned)  
⬜ The Lens — Phase 5 (planned)  
⬜ AI Detection — Phase 6 (planned)  
⬜ The Oracle — Phase 7 (planned)  
⬜ The Ward — Phase 8 (planned)  

## Documentation

- [System Design Document](docs/DESIGN.md)
- [Honeypot Setup Guide](docs/HONEYPOT_SETUP.md)
- [AWS Services Strategy](docs/AWS_STRATEGY.md)
- [Ethics & Responsible Use](docs/ETHICS.md)

## License

MIT
