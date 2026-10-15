/**
 * A host path as Docker accepts it in a mount made from inside a container.
 *
 * The update helper and the LOOK FOR DEV BUILDS helper are started from inside the backend
 * container, with the project's folders named as Docker reported them (compose labels, mounts).
 * On Linux and Mac those names are POSIX paths and work as they are. On Docker Desktop for
 * Windows they are Windows paths, `X:\CITY_NET`, and a mount written `-v X:\CITY_NET:...` is
 * refused ("invalid mode") because the drive letter's colon is read as a separator; compose
 * running in a Linux helper also takes `X:\...` for a relative path.
 *
 * Docker Desktop understands the same folder as `/x/CITY_NET` (checked on Docker Desktop 29 with
 * WSL2: a mount of `/c/...` from inside a container reaches the same files, and a compose up from
 * a helper with `--project-directory /c/...` recreated the stack on the same data). So a Windows
 * drive path becomes that; anything else is returned untouched.
 */
function dockerPath(p) {
  const raw = String(p ?? '');
  const drive = /^([A-Za-z]):[\\/]*(.*)$/.exec(raw);
  if (!drive) return raw;
  const rest = drive[2].replace(/\\/g, '/').replace(/\/+$/, '');
  return `/${drive[1].toLowerCase()}${rest ? `/${rest}` : ''}`;
}

module.exports = { dockerPath };
