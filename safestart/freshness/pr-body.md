### 3 thing(s) need you. About 9 minutes.

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

- [ ] **discord / dms** — Turning off Message Requests is no longer something a teen account can do themselves; Discord says modifying this setting is now restricted to age-assured adult users, with messages from unknown people instead routed to a separate inbox by default.
  - we currently say: _Turn off Message Requests if you'd rather nothing gets through at all._
  - the official page now says: _Message Request Inbox: ... access to modify this setting is limited to age-assured adult users._
  - their words: "access to modify this setting is limited to age-assured adult users"
  - check it: https://support.discord.com/hc/en-us/articles/14155043715735-Family-Center-for-Parents-and-Guardians
- [ ] **chromebook / web** — The menu path for web filtering no longer includes a 'Content restrictions' step; the current control is reached directly via Controls > Google Chrome and Web.
  - we currently say: _Family Link → [your child] → Controls → Content restrictions → Google Chrome_
  - the official page now says: _Open the Family Link app, select your child, tap Controls, then Google Chrome and Web_
  - their words: "Tap Controls Google Chrome and Web."
  - check it: https://support.google.com/families/answer/7101025?hl=en
- [ ] **chromebook / time** — Daily limits and bedtime are now accessed via a separate 'Screen time' section, not under 'Controls' as the guide states.
  - we currently say: _Family Link → [your child] → Controls → Daily limit / Bedtime_
  - the official page now says: _At the bottom left, tap Screen time, then Time limits_
  - their words: "At the bottom left, tap Screen time Time limits."
  - check it: https://support.google.com/families/answer/7101025?hl=en
- [ ] **hbomax / parentcode** — The Parent Code setup URL uses a different domain than the guide states.
  - we currently say: _play.hbomax.com/parent-code_
  - the official page now says: _www.hbomax.com/parent-code_
  - their words: "Go to www.hbomax.com/parent-code and sign in"
  - check it: https://help.hbomax.com/us/answer/detail/000002540

#### Hand-check on rotation: Disney+

help.disneyplus.com serves an app shell with no text in the HTML. That makes it impossible to check automatically, so one of the six comes up by hand each week and each gets looked at about monthly. Last done 2026-09-03.

Open the page and confirm these are still true. If they are, tick the box and merge:

  - Turn on Junior Mode for younger children — menu path: `Edit Profiles → [profile] → Parental Controls → Junior Mode`
  - Set the content rating for an older child — menu path: `Edit Profiles → [profile] → Parental Controls → Content rating`
  - Turn off unrated live content — menu path: `Edit Profiles → [profile] → Parental Controls → allow titles without ratings`

  - Disney+: parental controls (official): https://help.disneyplus.com/article/disneyplus-parental-controls
  - Disney+: Junior Mode (official): https://help.disneyplus.com/article/disneyplus-kids-profiles

- [ ] **Disney+** still matches its official page

---

<sub>11 guides confirmed unchanged and had their date bumped. 12 came back unclear, which nearly always means the official page does not mention the step at all, so no action is expected. Full detail in `safestart/freshness/`. This job never rewrites a guide's instructions.</sub>