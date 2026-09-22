# The Play Store listing

Everything Play asks for, with the answers worked out from what the code
actually does rather than from what sounds good. The data safety answers in
particular are published on the listing where any parent can read them, so
they need to be true.

Assets live in `ops/store/`.

---

## Store listing

### App name (30 characters max)

    SafeStart: Parental Controls

28 characters. "SafeStart" alone is cleaner but nobody searches for it, because
nobody knows it exists yet. The two words after the colon are what a parent
actually types into the store.

### Short description (80 characters max)

    Set up the parental controls already built into your child's devices and apps.

78 characters. This is the line that appears under the icon in search results,
and it is doing one job: telling a parent this is about settings they already
own rather than another app to install on a child's phone.

### Full description (4000 characters max)

Paste the block below. It runs about 2,300 characters, which is deliberate.
Store descriptions get skimmed, and the part that matters is the first two
lines before the More button.

---

SafeStart is a free, step-by-step guide to the parental controls already built
into your child's phone, tablet, console and apps. There is nothing to install
on their device and nothing to buy.

Tell it which device your child uses and roughly how old they are, and you get
one ordered list of what to change, most important first, split into short
parts so it is an evening job rather than a weekend one.

WHAT IT COVERS

Phones and tablets: iPhone, iPad, Android, Samsung Galaxy, Amazon Fire tablet,
Chromebook, Mac, Windows PC, Apple Watch.

Consoles: PlayStation, Xbox, Nintendo Switch.

Apps and games: Roblox, Minecraft, Fortnite, TikTok, Instagram, Snapchat,
YouTube, WhatsApp, Discord, Twitch, Spotify, Netflix, Disney+, Prime Video,
HBO Max, iMessage, and more.

HOW IT WORKS

Every step says what to tap, why it matters, and what that setting does not
cover, which is usually the part nobody tells you. Each one links to the
platform's own help page so you can check it rather than take our word for it.

Where two apps need the same setting, it is merged so you only do it once.

HONEST ABOUT WHAT THIS IS NOT

It is not monitoring software. Nothing keeps running after you finish, we
cannot see your child's phone, and no alert is ever coming from us.

It does not read anyone's messages. Neither does Apple's or Google's parental
control, whatever you may have been told. What they let you do is decide who
can reach your child, which is the part that prevents harm rather than
discovering it later.

It is not a way to stop children using apps and devices. It is a way to make
sure they are set up with the best level of safety available to them.

IF SOMETHING HAS ALREADY HAPPENED

There is a separate section for the harder situations: bullying, a stranger
making contact, an image that has been shared, an account that has been taken
over. It has the actual reporting routes for the UK, Ireland, the United States
and Canada, and it works offline, because the moment you need it is not the
moment to discover you have no signal.

KEPT CURRENT

Menus move. Every guide shows the date it was last checked and links to the
source, and every correction we have ever made is published with its date, so
the dates can be checked rather than trusted.

FREE, AND PRIVATE

No account. No sign-in. No cookies. No ads. No trackers. Nothing is sold and
there is nobody to sell it to. Your child never visits the site and needs
nothing from it: you read the guides on your own phone and change settings on
theirs.

SafeStart is made by TrustRaise and given away, because a parent should not
need a consultant to set up a tablet.

---

### Category

**Parenting.** Education is the other candidate and is a worse fit: this is not
a learning app, and Education is a far more crowded shelf.

### Tags

Parenting, Safety, Reference.

### Contact details

Email `dave@trust-raise.com`, website `https://safestart.trust-raise.com`.

### Privacy policy URL

    https://safestart.trust-raise.com/privacy/

---

## Graphics

All in `ops/store/`, regenerate with `node scripts/dev-server.js &` then
`node scripts/store-shots.js` and `node scripts/feature-graphic.js`.

| File | Size | What it is |
|---|---|---|
| `feature-graphic-1024x500.jpg` | 1024x500 | The banner at the top of the listing. Required. |
| `01-picker.png` | 1080x2400 | The home page and the device picker |
| `02-plan.png` | 1080x2400 | A built plan, showing the parts and the timing |
| `03-guide.png` | 1080x2400 | A guide, showing the checked date and the source badge |
| `04-device.png` | 1080x2400 | The Android device guide |
| `05-help.png` | 1080x2400 | The crisis page |

Play needs a minimum of two phone screenshots and allows eight. All five are
rendered from the real running site, so if the design changes they are one
command from being right again.

The app icon comes from the package itself and does not need uploading
separately.

---

## Data safety form

This one is published on your listing and a parent can read it, so it is worth
being precise. Everything below is derived from the code.

**Does your app collect or share any of the required user data types?**
Yes. Three things, all small.

| Data type | Collected | Shared | Why | Notes |
|---|---|---|---|---|
| App activity → App interactions | Yes | No | Analytics | Page views only. Vercel Web Analytics, no cookies, visitor identified by a hash of the request that is discarded within 24 hours. Optional, not required for the app to work. |
| Personal info → Email address | Yes | No | App functionality, Support | Only if the parent types one into the feedback form. Used to reply and nothing else. |
| Messages → Other in-app messages | Yes | No | App functionality | The question text a parent types into Ask SafeStart, and any feedback message. |

**Answers to the follow-up questions:**

- Is all user data encrypted in transit? **Yes.** The site is HTTPS only.
- Do you provide a way for users to request that their data is deleted?
  **Yes**, by email. The privacy policy says so.
- Is data collection required, or can users choose? Page views: **required**
  in Play's sense, since there is no toggle. Email and message content:
  **optional**, since nothing is sent unless the parent types it and submits.
- Is this data processed ephemerally? Page views: **yes**.

**What to say no to, because it is true:** no location, no personal
identifiers, no contacts, no photos or videos, no audio, no files, no calendar,
no health or fitness, no financial info, no web browsing history, no device
IDs, no data shared with third parties, and no data sold.

**One thing to get right.** Vercel, Anthropic and Resend are service providers
processing on your behalf, which under Play's definitions counts as collection,
not sharing. So "shared" is No throughout. The privacy policy names all three
by name, which is what backs this up if anyone asks.

---

## Content rating questionnaire

This is run by IARC, not Google, and it generates ratings for every region at
once. Answer honestly and take whatever comes back.

- **Category:** Reference, News, or Educational.
- Violence: none. Sexuality: none. Profanity: none. Controlled substances:
  none. Gambling: none. Horror or fear: none.
- Does the app allow users to interact or exchange content with each other?
  **No.** Ask SafeStart is a parent talking to a model, not to another person.
  There is no account, no profile and no way for one user to reach another.
- Does the app share the user's location with other users? **No.**
- Does the app allow users to purchase digital goods? **No.**
- Does the app contain ads? **No.**

**The one question to think about before you click.** IARC asks about
references to sensitive topics. The crisis section does discuss child sexual
abuse imagery, grooming, bullying and self-harm, in plain language, in an
educational context aimed at a parent. That is true and you should say so
rather than hope it goes unnoticed. The likely outcome is still a broad rating,
because the treatment is informational and there is no imagery. If it comes
back higher than you expect, that is not a problem worth fighting: the audience
is adults anyway.

---

## Target audience and content

- **Target age group: 18 and over only.** Do not tick any child age band.
- Does your store listing appeal to children? **No.**

This matters more than it looks. Ticking a child age group pulls the app into
Play's Families policy, which brings a heavier review, extra requirements, and
restrictions on what the app may do. SafeStart is a tool for the adult setting
up a device. The child never opens it.

---

## The other declarations

- **Ads:** the app contains no ads.
- **App access:** all functionality is available without any special access.
  There is no login, no account, and nothing behind a paywall, so no test
  credentials are needed. Say this explicitly, because a reviewer who cannot
  reach the app rejects it.
- **Government app:** no. **Financial features:** none. **Health:** no.
- **News app:** no.
- **Data deletion:** handled by email, per the privacy policy.
