# JARAN PRIVATE SCHOOL

Responsive school dashboard built with HTML, CSS, TypeScript, and browser LocalStorage.

## Publish with GitHub Pages
1. Extract this ZIP.
2. Create a new GitHub repository.
3. Add all project files to the repository's main branch, including .github/workflows/deploy.yml.
4. In Settings → Pages, select GitHub Actions as the publishing source.
5. Open Actions and wait for the publish workflow to finish.

The included workflow builds the project and publishes its dist folder on every push to main.

## Run locally
Install Node.js, then run:
```sh
npm ci
npm run dev
```

School records are stored in the current browser only and do not sync between devices. Use Backup / Restore to transfer them.

## Security notes
- School data is stored unencrypted in this browser only; there is no login.
- Do not use the app on shared computers.
- Backups are plain-text files containing student and guardian data; keep them private.
- Enable two-factor authentication (2FA) on the GitHub account.
