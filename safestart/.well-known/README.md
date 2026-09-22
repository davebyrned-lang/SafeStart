# Digital Asset Links

`assetlinks.json` is what tells Android that the app signed with a particular
key is allowed to open safestart.trust-raise.com without an address bar. If the
fingerprint here does not match the key the installed app was signed with, the
app still works but shows a Chrome address bar across the top, which looks
broken and is the single most common Trusted Web Activity mistake.

## What is in here now

**One fingerprint of the two.** The upload key, the one PWABuilder generated
when it built the package on 22 September 2026:

    42:84:B7:92:9C:3D:F3:E6:4A:74:C2:97:2F:6F:C1:D5:71:C6:82:CD:52:92:F9:98:39:A6:AF:99:5A:06:D1:C7

That key lives in `signing.keystore`, inside the PWABuilder zip, and it is not
in this repo and must never be. `.gitignore` covers `*.keystore`, `*.jks` and
`*.p12`, but the real protection is keeping it somewhere else entirely. Lose it
and SafeStart can never be updated under this listing again.

## What is still missing

**Google's app signing key.** Play strips the upload signature and re-signs
every release with a key Google holds, so the signature that reaches a parent's
phone is Google's and not ours. That key does not exist until the first bundle
is uploaded, which is why it cannot be filled in yet.

After the first upload to any track, find it in Play Console under Release →
Setup → App signing, and add it to `sha256_cert_fingerprints` alongside the one
above. Colon-separated uppercase hex, exactly as the console prints it.

Forgetting this second one is what ships an app with an address bar. The app
will look fine on the machine that built it and wrong on every real phone.

## Checking it worked

After deploying, this has to be readable at exactly:

    https://safestart.trust-raise.com/.well-known/assetlinks.json

served as `application/json`, which `vercel.json` already handles. Google's own
checker:

    https://developers.google.com/digital-asset-links/tools/generator

And the real test: install the APK and look at the top of the screen. An
address bar means a fingerprint is wrong or has not deployed yet.
