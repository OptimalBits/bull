Release process
---------------

First, update `CHANGELOG.md` with the release number about to be released.

    npm outdated --depth 0          # See if you can upgrade any dependencies
    npm version [major|minor|patch] # Update package.json
    npm publish                     # Tag repo and publish npm package
