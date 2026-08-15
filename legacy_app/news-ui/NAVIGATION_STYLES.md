# NewsScrapper navigation styles

The compact floating navbar is the default. The previous navbar is still maintained as the `classic` variant. Put the setting in `news-ui/.env.local`; Vite reads it when the frontend starts or builds.

## Use the new floating navbar

No setting is required. If you want to be explicit, add this before running or building the frontend:

```env
VITE_NEWSSCRAPPER_NAV_STYLE=floating
```

## Restore the previous navbar

Create or edit `news-ui/.env.local`, then add:

```env
VITE_NEWSSCRAPPER_NAV_STYLE=classic
```

Restart `npm run dev`, or run `npm run build` again for a production bundle. Vite settings are compiled into a production bundle, so an already-built `dist` folder must be rebuilt after changing this value. Route behavior, Settings, profile editing, translation, theme switching, and access-controlled tools are shared by both styles.
