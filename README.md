# Solara Nexus

Frontend hosted on Vercel, backend + database on Google Apps Script / Google Sheets.

## Folder structure

```
apps-script/   Code.gs, Api.gs, Index.html, Admin.html   (your Apps Script project files)
public/        gas-shim.js                              (index.html / admin.html are generated)
scripts/       build.js
package.json
vercel.json
README.md
```

## One-time Apps Script steps

1. Open your Apps Script project and add a new file `Api.gs` (paste `apps-script/Api.gs`).
2. In `Code.gs` set the sheet id (line 8):
   `const SHEET_ID = '10Vm12YaZOa6gjKmKEZLVR09SxTa-NnBdIWJqx8sJl74';`
3. Deploy > Manage deployments > edit (pencil) > Version: **New version** > Deploy.
   Execute as: **Me**, Who has access: **Anyone**. The /exec URL stays the same.

## Put your pages in apps-script/

Copy your existing `Index.html` and `Admin.html` into `apps-script/` unchanged.

## GitHub + Vercel

1. Push this whole folder to a GitHub repo.
2. Vercel > Add New Project > import the repo. No settings needed (vercel.json handles it).
3. Customer site: `https://YOUR-PROJECT.vercel.app/`
   Admin portal: `https://YOUR-PROJECT.vercel.app/admin`

If your Apps Script /exec URL ever changes, edit `API_URL` in `public/gas-shim.js`.
