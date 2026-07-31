import type { Metadata } from "next";
import "@fontsource/space-grotesk/300.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "./globals.css";
import "./portfolio-voices.css";

export const metadata: Metadata = {
  title: "Creekstone Ventures — Agent Native · Founder Friendly",
  description: "Creekstone Ventures. Building China's Founders Fund.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" as="image" href="/creekstone-mark.png" />
      </head>
      <body className="antialiased selection:bg-black selection:text-white">
        {/*
          THESIS: Turn Creekstone's earliest-founder conviction into a living signal field.
          OWN-WORLD: Warm ivory, dark gold, particle intelligence, precise field marks, and editorial typography.
          STORY: Visitors move from Creekstone's promise into the live AI VC Agent, then portfolio evidence, the three-person investment team, and the founder network.
          FIRST VIEWPORT: Creekstone's particle mark sits behind WE CREATE / WE SPARK, with verified brand language and founder principles at the edges.
          FORM: The computational interaction language is being rebuilt around Creekstone's official brand and content.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        {children}
      </body>
    </html>
  );
}
