### 2 thing(s) need you. About 7 minutes.

Tick each box once you have looked. Nothing below has been changed for you.

---

<sub>Run 1 of this check. These instructions appear on the first three, then stop.</sub>

**What this is.** Every Monday at 07:00 UTC a job re-reads the official documentation behind every guide on SafeStart and compares it against what the site publishes. This pull request is the result. It runs on GitHub, not on your machine, so nothing needs to be open.

**What it has already done, on its own.** Moved the `lastVerified` date forward on guides whose sources it could read and where nothing had changed. That is a fact it established, not an opinion it formed. It has not edited a single word of any guide's instructions, and it never will. A model quietly rewriting safety advice is how a wrong menu path reaches every reader at once.

**What to do.**

1. Read the heading above. If it says nothing needs a decision, hit Merge and you are done.
2. If there are checkboxes, work down them. Each one shows what we currently say, what the official page says now, and a link. Open the link and decide who is right.
3. Tick the box for anything you have looked at. The tick is a note to yourself, nothing depends on it.
4. If a guide genuinely needs changing, do not do it here. Say so in a comment, or bring it to Claude, and it gets fixed properly with the source cited.
5. Merge when you are done looking.

**What happens when you merge.** The updated dates go live on the site within a minute or so, and the changelog page publishes what this run found, including anything it flagged. That public record is the point: a verification date nobody can check is just a claim.

**What happens if you ignore it.** Nothing breaks. Next Monday's run replaces this pull request with a fresh one. The only cost is that the dates on the site stay older than they need to be.

**What happens if you close it without merging.** Same thing. The branch is rebuilt next week.

---

- [ ] **firetablet / age** — The guide claims Amazon renamed the age-filter setting to 'Content Maturity Filter & Languages', but the official Parent Dashboard page still refers to it by the old name.
  - we currently say: _Content Maturity Filter & Languages (guide says this replaced 'Adjust Age Filter')_
  - the official page now says: _Official page still calls it 'Adjust Age Filter'_
  - their words: "click on the gear next to the child's name and then the 'Adjust Age Filter' setting"
  - check it: https://www.aboutamazon.com/news/devices/set-up-fire-tablet-kids
- [ ] **applewatch / check** — Apple's watchOS user guide now states that for watchOS 27, Apple Watch For Your Kids requires a cellular-capable Apple Watch SE 3 or Series 9 or later, a materially higher hardware floor than the guide's 'Series 6 or SE or newer' reading.
  - we currently say: _Series 6 or SE or newer is the safe reading_
  - the official page now says: _On watchOS 27, requires cellular-capable SE 3 or Series 9 or later_
  - their words: "cellular-capable Apple Watch SE 3 or Apple Watch Series 9 or later"
  - check it: https://support.apple.com/en-us/109036

#### Hand-check on rotation: TikTok

support.tiktok.com sends Disallow: / in robots.txt, so we do not crawl it. That makes it impossible to check automatically, so one of the six comes up by hand each week and each gets looked at about monthly. Last done 2026-08-20.

Open the page and confirm these are still true. If they are, tick the box and merge:

  - Set up Family Pairing — menu path: `Profile → ☰ (top right) → Settings and privacy → Family Pairing`
  - Make the account private — menu path: `Family Pairing → [your teen] → Privacy and safety`
  - Limit messages, comments and mentions — menu path: `Family Pairing → [your teen] → Privacy and safety → Safety`

  - TikTok: Family Pairing (official support): https://support.tiktok.com/en/account-and-privacy/family-pairing
  - TikTok: Guardian’s Guide (official): https://www.tiktok.com/safety/en/guardians-guide/

- [ ] **TikTok** still matches its official page

---

<sub>8 guides confirmed unchanged and had their date bumped. 14 came back unclear, which nearly always means the official page does not mention the step at all, so no action is expected. Full detail in `safestart/freshness/`. This job never rewrites a guide's instructions.</sub>