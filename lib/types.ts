export type PortfolioCompany = {
  name: string;
  category: string;
  description: string;
  stage: string;
  founder: string;
  href?: string;
  logo?: string;
  logoSurface: "light" | "dark";
  side: "top" | "bottom";
  voice?: {
    text: string;
    avatar: string;
    role: string;
  };
};

export type Accomplishment = {
  year: string;
  title: string;
  desc: string;
};

export type Project = {
  tag: string;
  title: string;
  desc: string;
  status: "BUILDING" | "PLANNING" | "ITERATING";
  details: {
    story: string;
    stack: string[];
    highlights: string[];
    accomplishments: Accomplishment[];
  };
};

export type TeamMember = {
  id: string;
  initials: string;
  name: string;
  role: string;
  photo: string;
  focus: string;
  bio: [string, string];
};

export type PerspectiveItem = {
  href: string;
  source: string;
  title: string;
  category: "Portfolio Update" | "Intelligence" | "Essay" | "Letter" | "Podcast";
};
