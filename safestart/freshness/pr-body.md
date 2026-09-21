### 1 thing(s) need you. About 5 minutes.

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

- [ ] **chromebook / web** — The official path to the Chrome web filter no longer shows a 'Content restrictions' submenu; the setting is reached directly under Controls > Google Chrome and Web.
  - we currently say: _Family Link → [your child] → Controls → Content restrictions → Google Chrome_
  - the official page now says: _Tap Controls, then Google Chrome and Web, to choose the site filter setting._
  - their words: "Tap Controls Google Chrome and Web ."
  - check it: https://support.google.com/families/answer/7101025?hl=en
- [ ] **chromebook / time** — Daily limits and bedtime are now managed via a separate 'Screen time' section rather than under 'Controls'.
  - we currently say: _Family Link → [your child] → Controls → Daily limit / Bedtime_
  - the official page now says: _Screen time settings, including daily limits, are accessed via 'Screen time > Time limits', not 'Controls'._
  - their words: "tap Screen time Time limits ."
  - check it: https://support.google.com/families/answer/7101025?hl=en

#### Hand-check on rotation: WhatsApp

faq.whatsapp.com returns 400 to anything automated. That makes it impossible to check automatically, so one of the six comes up by hand each week and each gets looked at about monthly. Last done 2026-09-03.

Open the page and confirm these are still true. If they are, tick the box and merge:

  - If they are under 13, use a parent-managed account — menu path: `Child's phone: install and register → Parent's phone: scan QR → create parent PIN`
  - Check the minimum age, and what most guides get wrong — first instruction: `If your child is under 13, the parent-managed account above is the supported route.`
  - Tighten the four privacy settings — menu path: `Settings → Privacy`

  - WhatsApp: parent-managed accounts (official): https://faq.whatsapp.com/899820539143195
  - WhatsApp: parental controls for parent-managed accounts (official): https://faq.whatsapp.com/1201762518588626

- [ ] **WhatsApp** still matches its official page

---

<sub>7 guides confirmed unchanged and had their date bumped. 16 came back unclear, which nearly always means the official page does not mention the step at all, so no action is expected. Full detail in `safestart/freshness/`. This job never rewrites a guide's instructions.</sub>