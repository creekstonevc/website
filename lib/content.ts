import type {
  PerspectiveItem,
  PortfolioCompany,
  Project,
  TeamMember,
} from "./types";

export const portfolioCompanies: PortfolioCompany[] = [
  {
    name: "Youware",
    category: "AI Creative Platform",
    description:
      "AI-powered fashion & creative platform. One of the fastest-growing AI consumer companies from China.",
    stage: "Seed → Series A",
    founder: "Leon Ming",
    href: "https://www.youware.com/",
    logo: "/portfolio-logos/youware.svg",
    logoSurface: "light",
    side: "top",
    voice: {
      text: "If I had to choose one institution to have on my board, Creekstone would unequivocally be the one and only answer.",
      avatar: "/portfolio-voices/leon-ming.png",
      role: "Founder, Youware",
    },
  },
  {
    name: "Odysslife",
    category: "Supply Chain Intelligence",
    description:
      "Next-gen AI-powered supply chain platform. Deep tech meets global operations excellence.",
    stage: "Seed → Pre-A++",
    founder: "Chris Pan",
    href: "https://www.odyss.life/",
    logo: "/portfolio-logos/odyss.svg",
    logoSurface: "dark",
    side: "bottom",
    voice: {
      text: "Creekstone stands out as a pioneer with sharp, native AI investment intelligence. Poised to become a leading force in the AI revolution.",
      avatar: "/portfolio-voices/chris-pan.png",
      role: "Founder, Odysslife",
    },
  },
  {
    name: "Kaleidoscope",
    category: "Immersive AI Experience",
    description:
      "Redefining human-intelligence interaction through immersive AI platforms.",
    stage: "Seed → Series A",
    founder: "Qiuqiu",
    logoSurface: "dark",
    side: "top",
  },
  {
    name: "Verdent",
    category: "Agent-Native IDE",
    description:
      "The development environment built natively for the agent era. Code with intelligence.",
    stage: "Seed → Pre-A+",
    founder: "Zhijie",
    href: "https://www.verdent.ai/",
    logo: "/portfolio-logos/verdent.svg",
    logoSurface: "dark",
    side: "bottom",
  },
  {
    name: "Mizzen AI",
    category: "Enterprise Intelligence",
    description:
      "Connecting frontier AI capability with real enterprise transformation outcomes.",
    stage: "Seed → Pre-A",
    founder: "Keqiang",
    href: "https://mizzen.top/",
    logo: "/portfolio-logos/mizzen.svg",
    logoSurface: "light",
    side: "top",
  },
  {
    name: "Mem-U",
    category: "Memory-Augmented AI",
    description:
      "Building the persistent memory layer for AI agents and human-AI collaboration.",
    stage: "Seed → Pre-A",
    founder: "Peter Chen",
    href: "https://memu.pro/",
    logo: "/portfolio-logos/memu.svg",
    logoSurface: "light",
    side: "bottom",
    voice: {
      text: "Not just a check, but a true partner. When I felt lost, they helped me find my bearings. It's rare to find investors who genuinely roll up their sleeves alongside you.",
      avatar: "/portfolio-voices/peter-chen.png",
      role: "Founder, Mem-U",
    },
  },
  {
    name: "Xmax",
    category: "Productivity Suite",
    description:
      "Next-generation productivity infrastructure rebuilt for the distributed AI era.",
    stage: "Seed → Pre-A+",
    founder: "Jiaxin",
    href: "https://xmax.ai/",
    logo: "/portfolio-logos/xmax.png",
    logoSurface: "dark",
    side: "top",
  },
  {
    name: "Machine Pulse",
    category: "Operational Intelligence",
    description:
      "Turning machine data into strategic decisions in real time. AI at the operational layer.",
    stage: "Seed → Pre-A",
    founder: "Leah Wang",
    href: "https://app.karpo.ai/",
    logo: "/portfolio-logos/karpo.svg",
    logoSurface: "light",
    side: "bottom",
    voice: {
      text: "They are different than every investor I have ever seen. They are more like co-founders for us.",
      avatar: "/portfolio-voices/leah-wang.png",
      role: "Founder, Machine Pulse",
    },
  },
  {
    name: "RSI",
    category: "Frontier AI Research",
    description:
      "Recursive self-improvement architectures at the frontier of AGI research.",
    stage: "Strategic",
    founder: "Yuandong Tian",
    href: "https://www.recursive.com/",
    logo: "/portfolio-logos/recursive.svg",
    logoSurface: "dark",
    side: "top",
  },
  {
    name: "AirJelly",
    category: "AI-Native Productivity",
    description:
      "Always watching, always learning. AI that lives on your desktop and remembers everything.",
    stage: "Portfolio · Active",
    founder: "Baite Huang",
    href: "https://www.airjelly.ai/",
    logo: "/portfolio-logos/airjelly.svg",
    logoSurface: "light",
    side: "bottom",
  },
];

export const teamMembers: TeamMember[] = [
  {
    id: "luhuan-zhong",
    initials: "LZ",
    name: "Luhuan Zhong",
    role: "Investor",
    photo: "/team/luhuan-zhong.jpg",
    focus: "Full-cycle investment, angel to IPO",
    bio: [
      "8-year VC veteran with full-cycle investment experience spanning angel to IPO. Deep roots in China's startup ecosystem, known for finding the most ambitious founders before the market does.",
      "Directly involved in helping founders raise $150M+ across the past decade. Founders describe her support as \"co-founder level\", quick to decide and relentless in execution.",
    ],
  },
  {
    id: "yihao-li",
    initials: "YL",
    name: "Yihao Li",
    role: "Investor",
    photo: "/team/yihao-li.jpg",
    focus: "Product discovery, growth, founder partnership",
    bio: [
      "Former founder and active operator deeply embedded in China's entrepreneurial circles. Brings builder intuition to every investment and understands the founding journey from the inside.",
      "Specializes in product discovery, growth strategy, and long-term founder partnerships. Known for spotting company-market fit signals before they are obvious to anyone else.",
    ],
  },
  {
    id: "gary-zhang",
    initials: "GZ",
    name: "Gary Zhang",
    role: "Investor",
    photo: "/team/gary-zhang.jpg",
    focus: "Investment intelligence, sourcing, research",
    bio: [
      "Drives the intelligence and research layer at Creekstone. Focused on signal detection, founder sourcing, and the analytical infrastructure that keeps us at the frontier of AI investment intelligence.",
      "Builder of Creekstone's proprietary sourcing system and automated research platform. The best investments are found before anyone else is looking.",
    ],
  },
];

export const projects: Project[] = [
  {
    tag: "AIoT / AI Agent / Automation / Smart Hardware / Productivity",
    title: "Lumina AI Notebook",
    desc: "A wish-to-execution AI notebook that unifies software and hardware agents, turning raw ideas into deployable projects across brands and ecosystems.",
    status: "BUILDING",
    details: {
      story:
        "Lumina AI Notebook is positioned as a wish-to-execution system built on a proprietary OpenClaw-like AI agent architecture. It fuses AIoT hardware orchestration with software intelligence to convert daily tasks and fragmented ideas into executable projects, then autonomously track, pipeline, and execute them end to end. On the software side, agents can directly operate connected devices. On the hardware side, microcontrollers and Arduino modules provide resilient actuation. The core moat is cross-brand API orchestration that breaks vendor silos and delivers a unified automation entry point for full-home intelligence.",
      stack: ["Python", "C++", "WebSocket", "Expo", "LLM Fine-Tuning", "Arduino"],
      highlights: [
        "Built a proprietary OpenClaw-style architecture for full-stack AI agent orchestration",
        "Transforms inspirations and notes into projects with end-to-end autonomous execution",
        "Enables cross-brand smart-home API orchestration beyond vendor lock-in",
      ],
      accomplishments: [
        {
          year: "2026.02",
          title: "DIIS Hardware Hackathon Award",
          desc: "Competed at Shanghai DIIS Hardware Hackathon (Feb 27-Mar 1), won the Most Incubation Potential Award, and secured a CNY 10,000 prize.",
        },
        {
          year: "2026.03",
          title: "Live Smart-Control Demo",
          desc: "Executed a one-touch notebook-controlled lighting demo during the roadshow and gained strong investor attention.",
        },
        {
          year: "2026.03",
          title: "World-First Full-Scenario AIoT Scheduler",
          desc: "Developed a 4B AIoT Agent model capable of unified scheduling across daily life, SMB operations, and integrated industrial pipelines.",
        },
      ],
    },
  },
  {
    tag: "AI Fact-Checking / Browser Extension / Information Safety / Search AI",
    title: "ISITTRUE",
    desc: "A screenshot-native fact-checking extension that traces claims across the web and returns a confidence probability score in one action.",
    status: "PLANNING",
    details: {
      story:
        "ISITTRUE originated in December 2025 as a daily-use fact-checking product concept. Users capture any web content with a screenshot-like selection, and the system automatically retrieves and cross-validates information at web scale. It surfaces 10 authoritative sources with independent credibility scoring and outputs a final truth probability score. The product replaces manual verification workflows with near-zero friction. The MVP targets Chrome and Edge first, then expands to mobile for ubiquitous fact verification.",
      stack: [
        "Browser Extension",
        "Web Search API",
        "AI Scoring",
        "Frontend",
        "Source Credibility Evaluation",
      ],
      highlights: [
        "Screenshot-first interaction that dramatically lowers fact-checking friction",
        "Automated multi-source aggregation with independent credibility scoring",
        "Clear truth-probability output for faster information judgment",
      ],
      accomplishments: [
        {
          year: "2025.12",
          title: "Product Blueprint Finalized",
          desc: "Completed full-scope design from interaction flow and source logic to the credibility scoring framework.",
        },
        {
          year: "2025.12",
          title: "Architecture Feasibility Validated",
          desc: "Validated browser extension runtime, screenshot recognition path, and web search interface feasibility.",
        },
        {
          year: "2026.01",
          title: "MVP Scope Locked",
          desc: "Defined minimum browser feature scope and produced a development-ready requirement spec.",
        },
      ],
    },
  },
  {
    tag: "Productivity / Knowledge",
    title: "Are You Sure AI Mind Map",
    desc: "An AI decision intelligence system that breaks ambiguous ideas into structured nodes, risk branches, and executable tasks.",
    status: "PLANNING",
    details: {
      story:
        "Are You Sure AI Mind Map productizes the thinking process itself. It takes a question-centric input, auto-generates decision nodes, branching hypotheses, and action recommendations, then continuously iterates during collaboration. The result is a system that pushes projects beyond conceptual discussion into operational execution.",
      stack: ["TypeScript", "Graph Engine", "Prompt Orchestration", "Task Runtime"],
      highlights: [
        "Expands nodes into executable tasks automatically",
        "Supports risk tagging and branch priority reordering",
        "Translates abstract discussion into concrete execution paths",
      ],
      accomplishments: [
        {
          year: "2026.03",
          title: "Qualified for CCTV Selection",
          desc: "Recognized as a next-generation developer representative at a national AI talent summit and qualified for CCTV selection.",
        },
        {
          year: "2026.02",
          title: "Core Output at Beijing Tangquan Hackathon",
          desc: "Converted AI node divergence into deployable dynamic strategy trees and feedback loops, earning 3rd place overall.",
        },
        {
          year: "2025.10",
          title: "Commercial Validation",
          desc: "Leveraged strong engineering and rapid frontend delivery to generate 100+ inquiries in a single evening and validate revenue conversion.",
        },
      ],
    },
  },
  {
    tag: "HealthTech / AIoT / Smart Medication / Elderly Care / Home Health",
    title: "CareBox Smart Medication Hub",
    desc: "An integrated AI + hardware medication hub for seniors and chronic-care users, designed as the command center of home health management.",
    status: "BUILDING",
    details: {
      story:
        "CareBox targets critical medication safety failures: missed doses, incorrect doses, fragmented records, and lack of remote family oversight. It combines intelligent hardware with an AI health platform powered by AIoT orchestration, medication OCR recognition, senior-friendly voice/light alerts, and large-model health analytics. The system automates medication intake setup, reminder scheduling, and adherence logging while enabling remote monitoring for families and healthcare staff, with real-time anomaly alerts and full process traceability. The product is designed for both domestic eldercare demand and premium North American home/institutional markets.",
      stack: [
        "AIoT",
        "Embedded Systems",
        "OCR Image Recognition",
        "Large-Model Applications",
        "Cloud Computing",
        "Mobile Development",
      ],
      highlights: [
        "Senior-first interaction design with large text, voice guidance, and multimodal alerts",
        "Medication OCR automation that reduces missed, incorrect, and duplicate dose risks",
        "Unified hardware-mobile-cloud data loop enabling real-time remote monitoring",
        "Built for dual-market deployment with region-aware care and compliance requirements",
      ],
      accomplishments: [
        {
          year: "2026.03",
          title: "AI Hackathon Tour Global University League Finalist",
          desc: "Selected as an official finalist project and advanced through the competition evaluation pipeline.",
        },
        {
          year: "2026.03",
          title: "Nanjing Regional Champion",
          desc: "Won first place in the Nanjing regional round and advanced to the global finals.",
        },
        {
          year: "2026.03",
          title: "Crowd Favorite Award",
          desc: "Ranked #1 in audience voting at the global finals and received the Crowd Favorite Award.",
        },
      ],
    },
  },
  {
    tag: "Storage / Personal AI",
    title: "AI NAS",
    desc: "An intelligent private storage command center for individuals and small teams, combining local knowledge, AI retrieval, and workflow automation.",
    status: "ITERATING",
    details: {
      story:
        "AI NAS upgrades traditional network storage into a system that understands context, supports collaboration, and automates execution. Built on local-first deployment, it unifies file indexing, semantic retrieval, knowledge Q&A, and automation workflows in one entry point. The design maximizes information throughput without compromising data sovereignty or control.",
      stack: ["Linux", "Docker", "Vector DB", "RAG Pipeline", "Local LLM"],
      highlights: [
        "Built local knowledge indexing and semantic retrieval across directories with natural language queries",
        "Delivers document Q&A and summary generation to accelerate learning and project retrospectives",
        "Supports automated tagging, archiving, and backup orchestration to cut maintenance cost",
      ],
      accomplishments: [
        {
          year: "2025.09",
          title: "Personal Deployment Launched",
          desc: "Completed first local deployment and enabled full-path indexing plus semantic retrieval for cross-directory knowledge queries.",
        },
        {
          year: "2025.11",
          title: "RAG Q&A Integrated",
          desc: "Integrated local LLM runtime with a RAG pipeline for private-document Q&A and summarization.",
        },
        {
          year: "2026.01",
          title: "Automated Archiving Online",
          desc: "Launched auto-tagging classification and backup orchestration modules with major gains in file-management efficiency.",
        },
      ],
    },
  },
];

export const perspectiveItems: PerspectiveItem[] = [
  {
    href: "https://mp.weixin.qq.com/s/zg2LiDRUipkV0RFB4DXpWg",
    source: "AirJelly",
    title:
      "A Post-2000 ByteDance Team Built a Proactive AI Desktop Assistant That Predicts Your Next Move",
    category: "Portfolio Update",
  },
  {
    href: "https://mp.weixin.qq.com/s/NCbG4Lh9Tw2LN9382jjCww",
    source: "Verdent AI",
    title: "AI Can't Take Programmers' Jobs: We Cook for the Chef",
    category: "Portfolio Update",
  },
  {
    href: "https://mp.weixin.qq.com/s/XBibeZVk6M67VVa-EfZnyQ",
    source: "Mem-U",
    title:
      "Goodbye OpenClaw: After Mem-U Joined Feishu, My Slacking Looks Like Overtime",
    category: "Portfolio Update",
  },
  {
    href: "https://mp.weixin.qq.com/s/kaLHG7ZbsO7KG7jFYai_KA",
    source: "Mizzen AI",
    title: "8 People Trying to Break a Century-Old Industry's Kill Line",
    category: "Portfolio Update",
  },
  {
    href: "https://mp.weixin.qq.com/s/NMdN4vs1KetYNt5Jv6OWjg",
    source: "Research",
    title:
      "The Next Chapter of Agent Startups: Rebuilding the Human-AI Relationship",
    category: "Intelligence",
  },
  {
    href: "https://mp.weixin.qq.com/s/3NGyLjxB6aoOck4eleKo5A",
    source: "Creekstone",
    title:
      "We Invest in ByteDancers. We Invest in the Trauma-Forged. We Invest in Big Ambition, Small Ego.",
    category: "Essay",
  },
  {
    href: "https://mp.weixin.qq.com/s/ByFYzZucYuxyt13lY-xiZQ",
    source: "Creekstone",
    title: "Every Generation Gets the VC It Deserves",
    category: "Essay",
  },
  {
    href: "https://mp.weixin.qq.com/s/aHg_8nksk4Y1yMna-tHJHQ",
    source: "Creekstone",
    title:
      "An Open Letter to AI Founders: Believe in the Power of AI, Build the Future with the Young",
    category: "Letter",
  },
  {
    href: "https://www.xiaoyuzhoufm.com/episode/69c10d749b00c5ed7f1107f6",
    source: "Throw a Stone",
    title:
      "In Conversation with Yuandong Tian: Leaving Meta, Entering a New Era",
    category: "Podcast",
  },
  {
    href: "https://mp.weixin.qq.com/s/F5HayWBIAlcSuPB0PsiX4w",
    source: "Throw a Stone",
    title:
      "In Conversation with Mizzen AI: AI Is Sexiest in Slow, Expensive, Fragmented Markets",
    category: "Podcast",
  },
  {
    href: "https://mp.weixin.qq.com/s/oqzN0lnOlBG35K-MGx1XwA",
    source: "Throw a Stone",
    title:
      "In Conversation with Odysslife: Your Next Wearable Is the Health Companion Around Your Neck",
    category: "Podcast",
  },
];
