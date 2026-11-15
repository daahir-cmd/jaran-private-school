# Supabase login setup

The app's login and school records require a Supabase project and an internet connection. The browser receives only the project's public anon key. Never put the Supabase service-role key in the app, GitHub Pages variables, or this repository.

## Create and configure the project

1. Create a Supabase project and keep its database password private.
2. In **Authentication â†’ Providers â†’ Email**, disable email confirmations. Jaran account IDs are mapped to non-mailbox addresses ending in `@accounts.jaran.invalid`.
3. In the SQL Editor, run `supabase/migrations/202611150001_secure_login.sql`, then `supabase/migrations/202611150002_auth_hardening.sql` in order. The second migration adds a password-change trigger and updates the existing role-filtered RPCs; it does not add tables or change school data.
4. In **Authentication â†’ Users**, create the first user with email `admin8808@accounts.jaran.invalid` and initial password `ADMIN8808`. Copy its user UUID. The administrator must replace this initial password before school data can be read or changed.
5. In the SQL Editor, replace the UUID below with the user's UUID and run:

   ```sql
   insert into public.profiles
     (user_id, login_id, display_name, role, must_change_password)
   values
     ('00000000-0000-4000-8000-000000000000', 'ADMIN8808',
      'School Administrator', 'admin', true);
   ```

   Set `must_change_password` to `true`; the admin must choose a new password at first login.
6. Deploy both `supabase/functions/admin-create-account` and `supabase/functions/admin-reset-account` as Edge Functions. They use the project-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` secrets. Keep the service-role key only in Supabase's Edge Function secrets; never send it to the browser or commit it.
7. Copy the project URL and anon/public key from **Project Settings â†’ API** into a local `.env.local` file based on `.env.example`.
8. Add repository Actions variables named `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. These values are public frontend configuration, not service secrets. Rebuild and deploy the GitHub Pages site after setting them.
9. Sign in as `ADMIN8808`, change the initial password, then use **Accounts** to create teacher, finance, and student accounts. The app generates a random one-time password and shows it once; deliver it privately. Each new user must replace it at first sign-in. The database only clears the temporary-password gate after Supabase Auth changes the password.
10. Admins can issue a new random temporary password for a non-admin account from **Accounts**. It is displayed once, and the account must change it at the next sign-in. Since school IDs do not have recovery email addresses, users who forget a password must contact the administrator. If the only admin account is locked out, recover it through the Supabase dashboard.
11. Use **Backup / Restore** while signed in as admin to import the existing browser backup into the cloud store. The old LocalStorage data is not automatically uploaded or deleted.

## Access rules

- Admin: full school data, backup/restore, and account creation.
- Teacher: assigned class and attendance; student contact and payment fields are hidden.
- Finance: class rosters with student names and payment flags only; can mark fees paid.
- Student: their own attendance and payment status only.

Login, account changes, reads, and writes require an internet connection. The app does not cache school records for offline use.

