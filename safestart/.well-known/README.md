# Digital Asset Links

`assetlinks.json` is what tells Android that the app signed with a particular
key is allowed to open safestart.trust-raise.com without an address bar. If the
fingerprint here does not match the key the installed app was signed with, the
app still works but shows a Chrome address bar across the top, which looks
broken and is the single most common Trusted Web Activity mistake.

## The fingerprint is not in here yet, on purpose

It depends on a signing key that does not exist yet, and creating that key is
something only Dave should do. It is the key that proves a release came from
him, and there is no recovering it if it is lost: lose it and the app can never
be updated again under the same listing.

## Getting the fingerprint

Two of them matter, and both need to be listed here.

**Your upload key**, created once:

    keytool -genkeypair -v \
      -keystore safestart-upload.keystore \
      -alias safestart \
      -keyalg RSA -keysize 2048 -validity 10000

Then read its fingerprint:

    keytool -list -v -keystore safestart-upload.keystore -alias safestart

**Google's app signing key.** Play re-signs every release with a key Google
holds, so the fingerprint end users actually get is not the upload one. Find it
in the Play Console under Release, then Setup, then App signing. This is the one
people forget, and the app ships with an address bar because of it.

Put both into `sha256_cert_fingerprints` as colon-separated uppercase hex.

## Keep the keystore out of this repo

Back it up somewhere that is not a git repository and not this folder. The
`.gitignore` already covers `*.keystore` and `*.jks` so an accident is harder,
but the real protection is not keeping it here in the first place.

## Checking it worked

After deploying, this has to be readable at exactly:

    https://safestart.trust-raise.com/.well-known/assetlinks.json

served as `application/json`. Google's own checker:

    https://developers.google.com/digital-asset-links/tools/generator
