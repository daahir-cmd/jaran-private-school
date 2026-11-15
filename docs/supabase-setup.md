# Supabase login setup

The live app uses Supabase project `jfehvdxcglhcejpmkvbr` in the Free plan. Its database is currently empty. The browser receives only the project's public publishable key. Never put the Supabase service-role key in the app, GitHub Pages variables, or this repository.

## Create and configure the project

1. In **Authentication â†’ Users**, create the first user with email `admin8808@accounts.jaran.invalid`, choose a strong temporary password, and mark the user as confirmed. Copy its user UUID. Do not reuse a password from this guide.
2. In the SQL Editor, replace the UUID below with the user's UUID and run:

   ```sql
   insert into public.profiles
     (user_id, login_id, display_name, role, must_change_password)
   values
     ('00000000-0000-4000-8000-000000000000', 'ADMIN8808',
      'School Administrator', 'admin', true);
   ```

   Set `must_change_password` to `true`; the admin must choose a new password at first login.
3. Sign in to the live app as `ADMIN8808` with the temporary password, then replace it when prompted. Use **Accounts** to create teacher, finance, and student accounts. Their random one-time passwords are shown once; deliver each privately.
4. Admins can issue a new random temporary password for a non-admin account from **Accounts**. Since school IDs do not have recovery email addresses, users who forget a password must contact the administrator. If the only admin account is locked out, recover it through the Supabase dashboard.
5. The two migrations and both Edge Functions are already deployed to this project. For a separate fresh project, apply the migrations in filename order and deploy both functions. Edge Functions use Supabase's server-side `SUPABASE_SERVICE_ROLE_KEY`; keep it out of the browser and repository.
6. GitHub Pages builds with the project's URL and public publishable key. These values are frontend configuration and are safe to expose; the service-role key is never used by the frontend.
7. Use **Backup / Restore** while signed in as admin to import a local backup into the cloud store. No school records have been imported yet.

## Access rules

- Admin: full school data, backup/restore, and account creation.
- Teacher: assigned class and attendance; student contact and payment fields are hidden.
- Finance: class rosters with student names and payment flags only; can mark fees paid.
- Student: their own attendance and payment status only.

Login, account changes, reads, and writes require an internet connection. The app does not cache school records for offline use.

