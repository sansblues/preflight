# Preflight

Review your Half-Life speedrun before you submit. Drop your demos and see what the moderators look for. Everything runs in your browser, so your demos stay on your computer.

**Open it:** https://sansblues.github.io/preflight/

It reads `.dem` files, folders, `.zip`, `.7z` and `.rar`. It follows the rules of VolvoWrench, the moderators' tool, and also catches missing or out-of-order demos. The final call is the moderators'.

## Develop

```sh
npm install
npm run dev     # the page
npm test        # the tests
npm run build   # the site, in dist/
```

The rules in `src/rules.json` come from VolvoWrench. To update them, run `npm run rules -- path/to/VolvoWrench`. A weekly check fails when they change upstream.

## Credits

- The rules: [VolvoWrench](https://github.com/hobokenn/VolvoWrench), by the HL1 moderators.
- The demo data: [BunnymodXT](https://github.com/YaLTeR/BunnymodXT).
- `.7z` and `.rar`: [7-Zip](https://www.7-zip.org/) through [7z-wasm](https://github.com/use-strict/7z-wasm), under the GNU LGPL with the unRAR restriction. Its licences ship in `licenses/`.

## Licence

MIT
