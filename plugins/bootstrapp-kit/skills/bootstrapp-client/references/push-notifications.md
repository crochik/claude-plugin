# Push notifications in the client

The backend half (adding `google.push`, the scripts that register and send) is
in the `bootstrapp-apiscript` skill under "Service plugins". This file covers
what the app does. It's written for Flutter with `firebase_messaging`; a web
app follows the same steps with the Firebase JS SDK and a VAPID key.

## Before any code

1. **One Firebase project per app.** Add the Android and iOS apps to it
   (`flutterfire configure` writes `firebase_options.dart`), and upload the
   APNs auth key under Project settings > Cloud Messaging so iOS works.
2. **Point the account at that project.** Add the account's `firebase`
   integration with `add_integration` and `set_account_integration`
   (`projectId`, and `clientIds` = the app's OIDC client id). Have the user
   paste `serviceAccountJson` (the Admin SDK key file) in the designer,
   because secrets never go through the LLM. Without it, sends go through
   the platform's own Firebase project, and tokens from the app's project
   fail there (sender id mismatch).
3. **Add the plugin and its actions.** `add_plugin(app, "google.push")`,
   then an action whose script calls `push.registerToken(input.token)` and
   one that calls `push.unregisterToken(input.token)`. Regenerate the client
   so both actions are typed. The platform also has
   `PUT /app/api/PushNotification?token=…` (register for the signed-in user
   and client) and `DELETE /app/api/PushNotification` (all of this user's
   tokens for this client), but they aren't in the app's generated spec,
   so prefer the actions.

## In the app

1. **After sign-in** (never before: registration is for the signed-in
   user), request permission with `FirebaseMessaging.instance.requestPermission()`.
   On iOS, wait for `getAPNSToken()` before `getToken()`.
2. **Register** the token from `getToken()` through the register action. Do
   it on every sign-in and app start. Registering the same token again keeps
   one registration.
3. **Keep it current:** listen to `onTokenRefresh` and register the new
   token. A token Firebase reports as unregistered is deactivated by the
   platform on the next send.
4. **On sign-out,** call the unregister action with the current token
   *before* dropping the session, then `deleteToken()`. Otherwise the next
   user on the device gets the previous user's notifications.
5. **Handle the three entry points:**
   - `FirebaseMessaging.onMessage` (app in the foreground). Android shows
     nothing by itself, so show it with `flutter_local_notifications` on the
     same channel id the backend sends (`channel`).
   - `onMessageOpenedApp` (tapped while in the background).
   - `getInitialMessage()` (tapped while the app was terminated).
6. **Route on the data, not the text.** Every push carries string `data`:
   - `entityId`: the user it is for.
   - `objectType` and `objectId`: the record it is about, when the script
     passed one.
   - `url`, `action` and `category`: as the script set them.
   - `id` and `backgroundUrl`: the recorded notification.
   - plus the script's own `data` keys.
   Open the record or route from those.
7. **Marking it read.** Opening `backgroundUrl` (a signed link, no sign-in)
   marks the notification read and redirects to its `url`. The app can
   mark it read the same way: send a `GET` to `backgroundUrl` and don't
   follow the redirect. Never build that url yourself: an id without the
   platform's key is refused.

## Silent pushes and delivery options

A script sending `silent: true` sends data only. Nothing is shown and nothing
is recorded (no `id` or `backgroundUrl` in the data), and the title and body,
if given, arrive as `data.title` and `data.body`. On Android, handle it in
`FirebaseMessaging.onBackgroundMessage` (a top-level function). On iOS, enable
the Background Modes "Remote notifications" capability; iOS throttles
background pushes, so use them to refresh data, not for anything the user
must see.

- `channel` must be an Android channel the app has created (with
  `flutter_local_notifications` or natively) before the push arrives.
  Otherwise Android uses the app's default channel.
- `sound` is `default` or a sound file the app bundles: Android
  `res/raw/<name>`, iOS a file in the app bundle.
- `badge` sets the iOS app icon count (0 clears it).
- `timeToLive` (seconds) limits how long Firebase keeps trying an offline
  device; 0 means now or never.

## Checking it end to end

Send to yourself from a test action with
`push.sendToToken(token, { title: "Test", body: "It works" })`, and check
the result: `successCount` is 1, and a `failureCount` with no exception
usually means a wrong Firebase project. Test all three entry points on a real
device; iOS simulators don't receive pushes from APNs.
