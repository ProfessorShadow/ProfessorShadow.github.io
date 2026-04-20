# Veolia Dashboard - Tableau Public Web Page Embed

This folder is the static site package for Tableau Public.

## Hosted URL To Use In Tableau Public

After uploading this folder to a static host, use this URL in Tableau Public's `Web Page` object:

```text
https://YOUR-HOST/sales-onboarding-superstore/index.html
```

The root URL also redirects to the dashboard:

```text
https://YOUR-HOST/
```

## Fastest Hosting Option

Use Netlify Drop:

1. Go to `https://app.netlify.com/drop`.
2. Drag this whole `public-site` folder into the page.
3. Copy the HTTPS URL Netlify gives you.
4. In Tableau Public, drag a `Web Page` object onto the dashboard.
5. Paste:

   ```text
   https://YOUR-NETLIFY-SITE.netlify.app/sales-onboarding-superstore/index.html
   ```

## GitHub Pages Option

1. Create a GitHub repository.
2. Upload the contents of this `public-site` folder.
3. In the repository, open `Settings > Pages`.
4. Set the source to the main branch root.
5. Use:

   ```text
   https://YOUR-USERNAME.github.io/YOUR-REPO/sales-onboarding-superstore/index.html
   ```

## Tableau Public Limitation

This is a Web Page embed, not a Tableau extension. The HTML dashboard interactions work inside the embedded page, but Tableau Public worksheet filters do not drive the HTML dashboard.
