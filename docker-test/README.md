# The updater on real Docker

`updater-journey.mjs` checks the in-app updater the way a real install uses it, on real Docker.
The updater's unit tests replace Docker with stand-ins, and twice the stand-ins agreed with a
wrong assumption the code made: Windows servers failed every update, and the second in-app update
after any first one failed. Neither showed until a real install hit it.

## What a run does

1. Starts a **local image registry** (`localhost:5099`), so nothing is published and nothing is
   downloaded from Docker Hub but the registry itself and an nginx stand-in for the frontend.
2. Builds the **real server image from this checkout**, as the release does, and publishes it there.
3. Starts a **throwaway install** in your temp folder from the real `docker-compose.yml` (images
   from the local registry; no DuckDNS), with a test-only GM and its own `.env` files. Your own
   install and database are never touched.
4. Drives the **real updater through the server's API** and checks a value in the database
   survives every step:
   - an in-app update, then a second one straight after;
   - LOOK FOR DEV BUILDS ticked: a copy of the database, `IMAGE_TAG=dev` in both `.env` files, and
     an update onto a dev build;
   - on a build that has it (the dev builds), GO BACK TO STABLE straight after the stack was
     restarted by hand from the host: the copy put back (data written on the dev build gone, the dev
     database set aside), then one more in-app update, and the box ticked again;
   - the box unticked: `IMAGE_TAG=latest` in both files.
5. Removes everything it made: the containers, the registry, its images and the temp folder.

## Run it

You need Docker running (Docker Desktop on Windows or Mac) and Node.js 20 or later. From the
repository root:

```bash
node docker-test/updater-journey.mjs
```

It takes a few minutes the first time, mostly building the server image. It prints each step and
ends with `PASSED`, or `FAILED` with the server's log and the update log. Add `--keep` to leave a
failed install in place for a look.

## When it runs

- **CI**, on every pull request, on Linux: the **Updater on Real Docker** job.
- **By hand on Windows** (Docker Desktop) before any change to the updater is released, since CI
  can't run Docker Desktop for Windows and Windows paths are where it broke first.
