const NEWS = [
  { href: "https://mp.weixin.qq.com/s/zg2LiDRUipkV0RFB4DXpWg", date: "AirJelly", title: "A Post-2000 ByteDance Team Built a Proactive AI Desktop Assistant That Predicts Your Next Move", tag: "Portfolio Update ↗" },
  { href: "https://mp.weixin.qq.com/s/NCbG4Lh9Tw2LN9382jjCww", date: "Verdent AI", title: "AI Can't Take Programmers' Jobs — We Cook for the Chef", tag: "Portfolio Update ↗" },
  { href: "https://mp.weixin.qq.com/s/XBibeZVk6M67VVa-EfZnyQ", date: "Mem-U", title: "Goodbye OpenClaw — After Mem-U Joined Feishu, My Slacking Looks Like Overtime", tag: "Portfolio Update ↗" },
  { href: "https://mp.weixin.qq.com/s/kaLHG7ZbsO7KG7jFYai_KA", date: "Mizzen AI", title: "8 People Trying to Break a Century-Old Industry's Kill Line", tag: "Portfolio Update ↗" },
  { href: "https://mp.weixin.qq.com/s/NMdN4vs1KetYNt5Jv6OWjg", date: "Research", title: "The Next Chapter of Agent Startups: Rebuilding the Human-AI Relationship", tag: "Intelligence ↗" },
];

const READING = [
  { href: "https://mp.weixin.qq.com/s/3NGyLjxB6aoOck4eleKo5A", date: "Creekstone", title: "We Invest in ByteDancers. We Invest in the Trauma-Forged. We Invest in Big Ambition, Small Ego.", tag: "Essay ↗" },
  { href: "https://mp.weixin.qq.com/s/ByFYzZucYuxyt13lY-xiZQ", date: "Creekstone", title: "Every Generation Gets the VC It Deserves", tag: "Essay ↗" },
  { href: "https://mp.weixin.qq.com/s/aHg_8nksk4Y1yMna-tHJHQ", date: "Creekstone", title: "An Open Letter to AI Founders: Believe in the Power of AI, Build the Future with the Young", tag: "Letter ↗" },
];

const EPISODES = [
  { href: "https://www.xiaoyuzhoufm.com/episode/69c10d749b00c5ed7f1107f6", date: "EP.01", title: "In Conversation with Yuandong Tian: Leaving Meta, Entering a New Era", tag: "Throw a Stone ↗" },
  { href: "https://mp.weixin.qq.com/s/F5HayWBIAlcSuPB0PsiX4w", date: "EP.02", title: "In Conversation with Mizzen AI: AI Is Sexiest in Slow, Expensive, Fragmented Markets", tag: "Throw a Stone ↗" },
  { href: "https://mp.weixin.qq.com/s/oqzN0lnOlBG35K-MGx1XwA", date: "EP.03", title: "In Conversation with Odysslife: Your Next Wearable Is the Health Companion Around Your Neck", tag: "Throw a Stone ↗" },
];

function Item({ item }: { item: { href: string; date: string; title: string; tag: string } }) {
  return (
    <a href={item.href} target="_blank" rel="noreferrer" className="pitem pitem-link">
      <div className="pdate">{item.date}</div>
      <div className="ptitle">{item.title}</div>
      <div className="ptag">{item.tag}</div>
    </a>
  );
}

export default function Perspectives() {
  return (
    <section id="perspectives">
      <div className="pv-inner">
        <div className="sl fi">06 · Perspectives</div>
        <div className="pv-grid">
          <div className="fi">
            <div className="pv-ch">Portfolio News</div>
            {NEWS.map((i) => <Item item={i} key={i.href} />)}
          </div>
          <div className="fi d1">
            <div className="pv-ch">Reading List</div>
            {READING.map((i) => <Item item={i} key={i.href} />)}
          </div>
          <div className="fi d2">
            <div className="pv-ch">Podcast</div>
            <a
              href="https://www.xiaoyuzhoufm.com/podcast/69be621998de88d406855f6e"
              target="_blank"
              rel="noreferrer"
              className="pod-box"
              style={{ display: "flex", gap: 16, textDecoration: "none", color: "inherit", marginBottom: 20 }}
            >
              <div className="pod-ico">▶</div>
              <div>
                <div className="pod-ttl">Throw a Stone 投石问溪</div>
                <div className="pod-sub">Creekstone's podcast on young founders, AI-native building, and what it takes to bet on the frontier.</div>
                <div className="pod-ep" style={{ color: "var(--g)", marginTop: 6 }}>小宇宙 ↗</div>
              </div>
            </a>
            {EPISODES.map((i) => <Item item={i} key={i.href} />)}
          </div>
        </div>
      </div>
    </section>
  );
}
