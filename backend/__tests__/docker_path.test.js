import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { dockerPath } = require('../dockerPath.js');
const updater = require('../updater.js');
const channel = require('../updateChannel.js');

// The Windows paths below are as Docker Desktop reported them on a real install (compose labels
// and mounts read from inside the backend container): `X:\CITY_NET`, `X:\CITY_NET\docker-compose.yml`.

describe('dockerPath', () => {
  it('turns a Windows drive path into the form Docker Desktop mounts from inside a container', () => {
    expect(dockerPath('X:\\CITY_NET')).toBe('/x/CITY_NET');
    expect(dockerPath('X:\\CITY_NET\\docker-compose.yml')).toBe('/x/CITY_NET/docker-compose.yml');
    expect(dockerPath('C:\\Users\\GM\\My Games\\CITY_NET\\')).toBe('/c/Users/GM/My Games/CITY_NET');
    expect(dockerPath('d:/city/net')).toBe('/d/city/net');
    expect(dockerPath('E:\\')).toBe('/e');
  });

  it('leaves Linux and Mac paths exactly as they are', () => {
    expect(dockerPath('/opt/citynet')).toBe('/opt/citynet');
    expect(dockerPath('/Users/gm/CITY_NET/docker-compose.yml')).toBe('/Users/gm/CITY_NET/docker-compose.yml');
    expect(dockerPath('/home/gm/X:\\odd')).toBe('/home/gm/X:\\odd');
  });

  it('gives no colon to a mount spec, which is what Docker refused', () => {
    expect(dockerPath('X:\\CITY_NET')).not.toContain(':');
  });
});

describe('the helpers, on a Windows host', () => {
  const mountsOf = (args) => args.filter((_, i) => args[i - 1] === '-v');

  it('the update helper mounts and runs compose on the /x/ form', () => {
    const args = updater.buildUpdateHelperArgs('X:\\CITY_NET', 'X:\\CITY_NET\\docker-compose.yml', ['-p', 'city_net']);
    expect(mountsOf(args)).toEqual([
      '/var/run/docker.sock:/var/run/docker.sock',
      '/x/CITY_NET:/x/CITY_NET',
      '/x/CITY_NET/docker-compose.yml:/x/CITY_NET/docker-compose.yml:ro',
    ]);
    expect(args[args.indexOf('--project-directory') + 1]).toBe('/x/CITY_NET');
    expect(args[args.indexOf('-f') + 1]).toBe('/x/CITY_NET/docker-compose.yml');
  });

  it('the LOOK FOR DEV BUILDS helper mounts and writes the /x/ form', () => {
    const args = channel.channelHelperArgs('over2take/citynet-backend:1.14.7', 'X:\\CITY_NET', 'dev');
    expect(mountsOf(args)).toEqual(['/x/CITY_NET:/x/CITY_NET']);
    expect(args.slice(-2)).toEqual(['/x/CITY_NET', 'dev']);
  });

  it('a Linux host is unchanged', () => {
    const args = updater.buildUpdateHelperArgs('/opt/citynet', '/opt/citynet/docker-compose.yml', []);
    expect(mountsOf(args)).toContain('/opt/citynet:/opt/citynet');
    expect(args[args.indexOf('--project-directory') + 1]).toBe('/opt/citynet');
  });
});
