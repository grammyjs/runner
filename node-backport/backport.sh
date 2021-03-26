#!/bin/bash

if [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
    echo
    echo "     DENO -> NODE backport script"
    echo
    echo "This script pulls in the Deno code base"
    echo "and transforms it to a Node.js module."
    echo
    echo "Possible flags:"
    echo "  --full            Force recreating the backport from scratch"
    echo "                      by deleting all information about"
    echo "                      incremental compilation"
    echo "                      (i.e. all cached artifacts)"
    echo
    exit 0
fi

if [ "$1" == "--full" ]; then
    echo "Recreating backport from scratch (--full given)"
    git clean -fX .tsbuildinfo out
fi

git clean -fX src

echo "Pulling in and transforming source code"
cp -r ../deno/src .

# Strip file extensions from imports
find src -type f -name "*.ts" | xargs sed -Ei -e "s/from(\\s+)'\\.(\\.?)\\/([a-z\\-\\.\\/]+)\\.ts'$/from\\1'.\\2\\/\\3'/g"
# could also rename files if the regex ever fails, but leads to unreadable file names (*.ts.js, *.ts.d.ts, etc)
# find src -type f -name "*.ts" | xargs -I % mv % %.ts

# Inject polyfilling import calls where necessary
grep -lr "AbortController" src | xargs -r sed -Ei -e "1s/^/import { AbortController } from 'abort-controller'\n/"
grep -lr "AbortSignal" src | xargs -r sed -Ei -e "1s/^/import { AbortSignal } from 'abort-controller'\n/"

echo "Emitting JS output"
npm run -s build &&
    # TODO: switch to Deno once `ts-morph` was ported
    echo "Creating ESM compatibility layer" &&
    node create-esm-wrapper.js &&
    echo "Success!"
