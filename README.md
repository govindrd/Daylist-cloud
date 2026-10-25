# Daylist

A personal to-do list that syncs in real time across devices with Firebase Authentication and Cloud Firestore.

The interface includes day and night themes; the selected theme is saved in the browser. The app footer credits Govind Rathod.

## Run locally

1. Create a Firebase project and register a web app.
2. In Firebase Authentication, enable **Email/Password**.
3. Create a Cloud Firestore database.
4. Copy `.env.example` to `.env.local` and fill in the web app's Firebase configuration values. The Measurement ID is only used for optional Analytics; Authentication and Firestore work without it.
5. Deploy the included Firestore rules:

   ```sh
   firebase deploy --only firestore:rules
   ```

6. Install dependencies and start the app:

   ```sh
   npm install
   npm run dev
   ```

Tasks are stored under `users/{userId}/tasks/{taskId}` and folders under `users/{userId}/folders/{folderId}`. Each task stores its folder ID, and each nested folder stores its parent folder ID. Folders can be renamed without moving their tasks or child folders. Deleting a folder permanently deletes that folder, all descendant folders, and all tasks inside the folder tree after a confirmation prompt. Older tasks without a folder are kept in **Unsorted**, so existing data remains accessible. Sign in with the same account on each device to access the same live-synced folder hierarchy and tasks. The Firestore rules restrict each user's folders and tasks to that authenticated user.

Publish `firestore.rules` in **Cloud Firestore → Rules** (or deploy them with the Firebase CLI) to allow authenticated access to the folders collection.
