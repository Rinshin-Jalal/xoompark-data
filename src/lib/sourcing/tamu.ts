import 'server-only';
import https from 'node:https';
import { upsertSourcedLocation } from './store.ts';
import { extractTamuGarages, extractTamuRateText, ingestTamuGarages } from './tamuParse.ts';

// Recon (2026-08-25): transport.tamu.edu is a plain ASP.NET WebForms site
// (the /parking/ index 403s, but the Parking/*.aspx pages are open). Two
// pages carry the data: garages.aspx has the facility list (table.table-
// striped: Location | Clearance Levels, 7 garages), and visitor.aspx has the
// campus-wide visitor rate tiers (Duration | Day Rate | Night Rate). The
// visitor.aspx live-occupancy grid is JS-filled and deliberately skipped.
// No clean per-garage rate join exists, so the visitor.aspx rate schedule is
// applied as a shared priceText to every garage (see tamuParse.ts).
//
// TLS workaround: TAMU's server sends an incomplete certificate chain (leaf
// only — the InCommon RSA OV SSL CA 3 intermediate is missing) AND the
// Sectigo root isn't in Node's default trust store, so Node's fetch (undici)
// fails with "unable to get issuer certificate" while browsers/curl repair
// via AIA chasing. Supplying the missing intermediate + root through a
// custom https.Agent is a documented fix for a server-side misconfiguration
// — verification still happens against the real chain, nothing is bypassed.
// (Certs are public, fetched from crt.sectigo.com on 2026-08-25.)
// Exported for sourceUrlFetch.ts's admin "Paste URL" panel — TAMU's fixed
// sweep always hits these two pages regardless of what's pasted, and reuses
// this file's TLS workaround below rather than duplicating it.
export const TAMU_GARAGES_URL = 'https://transport.tamu.edu/Parking/garages.aspx';
export const TAMU_VISITOR_URL = 'https://transport.tamu.edu/Parking/visitor.aspx';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const INCOMMON_INTERMEDIATE = `-----BEGIN CERTIFICATE-----
MIIGIzCCBAugAwIBAgIRAJa22zsNXLm6Xd6KrItt/ncwDQYJKoZIhvcNAQEMBQAw
XzELMAkGA1UEBhMCR0IxGDAWBgNVBAoTD1NlY3RpZ28gTGltaXRlZDE2MDQGA1UE
AxMtU2VjdGlnbyBQdWJsaWMgU2VydmVyIEF1dGhlbnRpY2F0aW9uIFJvb3QgUjQ2
MB4XDTI1MTEwNjAwMDAwMFoXDTM1MTEwNTIzNTk1OVowSDELMAkGA1UEBhMCVVMx
FjAUBgNVBAoTDUluQ29tbW9uLCBMTEMxITAfBgNVBAMTGEluQ29tbW9uIFJTQSBP
ViBTU0wgQ0EgMzCCAaIwDQYJKoZIhvcNAQEBBQADggGPADCCAYoCggGBAInzD7j/
Ja1OZOvyIIe2hFOdDrois8Iiuyh+RtSKaKyQAvSRdG1b0Iz+fxOZaNPlM2RCTa9N
Ar/bs9Tts4RXTDCuLJfCPPwbRtSZMvBrZVpcPU3xVBbTUHTsYZ+SmlzB+qIwEJV6
TU8vEsdqosCwA/iOXewiRmUf5FxU2WoU4nD8iVFhu/p6h6YmI+AgswZ4lwZdNKW5
9cTvpuY8VefEWHuwvSQlzekLLBqiFJhlCu8dNrBsahT07sjMHVZVHU8Biss3bX04
FTzkDzv5eZ/U2LFA0rV2QzLpeLtIsMsXhlrEmuT4g6cbJJ3ZfWGHX77jnCIczshi
taD1BiTA9PRv9JWW6xQ+cGfHRMyHWTBNhdQI22N9UO65R+6ddwEWupViEGRUuO/O
ZbTtBSkoEBejHBfI3/BnnhLpKXTGC5N20om7nQ2UqOcgOpewiE9P+DnMrnUsqp9e
IS6NgkCCCuhS6eoHS3DwJouIK1T5CE/4xSrEuU0QTFRJfyqlIaMbKMe+awIDAQAB
o4IBbzCCAWswHwYDVR0jBBgwFoAUVnNYZJX5khqwEioEYnmhQBWIIUkwHQYDVR0O
BBYEFNoiNz/l03Ta2Xk+0XJt1ZNLIDevMA4GA1UdDwEB/wQEAwIBhjASBgNVHRMB
Af8ECDAGAQH/AgEAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMBMGA1UdIAQMMAowCAYG
Z4EMAQICMFQGA1UdHwRNMEswSaBHoEWGQ2h0dHA6Ly9jcmwuc2VjdGlnby5jb20v
U2VjdGlnb1B1YmxpY1NlcnZlckF1dGhlbnRpY2F0aW9uUm9vdFI0Ni5jcmwwgYQG
CCsGAQUFBwEBBHgwdjBPBggrBgEFBQcwAoZDaHR0cDovL2NydC5zZWN0aWdvLmNv
bS9TZWN0aWdvUHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LnA3YzAj
BggrBgEFBQcwAYYXaHR0cDovL29jc3Auc2VjdGlnby5jb20wDQYJKoZIhvcNAQEM
BQADggIBADoIPZD+zZzMmsZaUIc4WiV5NwHbB5nnmvSaDas20GSsyRiSnQVUwCT6
RzJJhPGJnoIHL7uYyjZDnYrB4MOL/1c0g+7BFmDY+0/csUwdHlouTOrj17T3nyrR
JjEg3/bY16ojl91ji4g4XbvB7L2tKkK2kF+dcIECRbcw+vE2gLSv7wcl78+m0jjb
3nw8Z+bs/R/W7C8kn+6bfgRrI2NGhd2wnJ579xMLUoodj/L2sXokw0/jiDrWgGAd
MijIVvVFSTaI08/8LReuluxbFCvftNBwiBVZm7UMV3hwZ97dqW+Tq4+Lh9GrbnO/
tMMSVSib+KKRMDYh5HGfjmmW9UTmaTL23oP7XPNuuOwqy0Z4RGqMWd8JYvNe0XFw
7rs73SJJN3zccKZvznDSaCzJBCjT3i3JrbbSW1cZKn0RFHhkFZmtP63HiXAo+G0n
Z7C/INTWdQcy9tJ/tYfC/ZVjap7R2C8s7XO2PR3oBvATgaRFIPF7q7+kyN0qmwfl
7Kt0O+dFw88fvjKfMIMQtnNqY7bWpGWg0XstM1L4kwi1FFNElCjFJR3rN5kpf5n1
7LqhsLc296cnFIwf/Yu9FaPkOJiGga6FewBTGqcWj8lL2KgHn95hdky0FzgIKRYw
loK8Ee0Y9wee43mVaHEdRD11fUQZYXsnXIFFtVXsIFH43LTiYfgN
-----END CERTIFICATE-----`;

const SECTIGO_ROOT = `-----BEGIN CERTIFICATE-----
MIIFijCCA3KgAwIBAgIQdY39i658BwD6qSWn4cetFDANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNNDYwMzIxMjM1OTU5WjBfMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQDEy1TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYwggIiMA0GCSqGSIb3DQEB
AQUAA4ICDwAwggIKAoICAQCTvtU2UnXYASOgHEdCSe5jtrch/cSV1UgrJnwUUxDa
ef0rty2k1Cz66jLdScK5vQ9IPXtamFSvnl0xdE8H/FAh3aTPaE8bEmNtJZlMKpnz
SDBh+oF8HqcIStw+KxwfGExxqjWMrfhu6DtK2eWUAtaJhBOqbchPM8xQljeSM9xf
iOefVNlI8JhD1mb9nxc4Q8UBUQvX4yMPFF1bFOdLvt30yNoDN9HWOaEhUTCDsG3X
ME6WW5HwcCSrv0WBZEMNvSE6Lzzpng3LILVCJ8zab5vuZDCQOc2TZYEhMbUjUDM3
IuM47fgxMMxF/mL50V0yeUKH32rMVhlATc6qu/m1dkmU8Sf4kaWD5QazYw6A3OAS
VYCmO2a0OYctyPDQ0RTp5A1NDvZdV3LFOxxHVp3i1fuBYYzMTYCQNFu31xR13NgE
SJ/AwSiItOkcyqex8Va3e0lMWeUgFaiEAin6OJRpmkkGj80feRQXEgyDet4fsZfu
+Zd4KKTIRJLpfSYFplhym3kT2BFfrsU4YjRosoYwjviQYZ4ybPUHNs2iTG7sijbt
8uaZFURww3y8nDnAtOFr94MlI1fZEoDlSfB1D++N6xybVCi0ITz8fAr/73trdf+L
HaAZBav6+CuBQug4urv7qv094PPK306Xlynt8xhW6aWWrL3DkJiy4Pmi1KZHQ3xt
zwIDAQABo0IwQDAdBgNVHQ4EFgQUVnNYZJX5khqwEioEYnmhQBWIIUkwDgYDVR0P
AQH/BAQDAgGGMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEMBQADggIBAC9c
mTz8Bl6MlC5w6tIyMY208FHVvArzZJ8HXtXBc2hkeqK5Duj5XYUtqDdFqij0lgVQ
YKlJfp/imTYpE0RHap1VIDzYm/EDMrraQKFz6oOht0SmDpkBm+S8f74TlH7Kph52
gDY9hAaLMyZlbcp+nv4fjFg4exqDsQ+8FxG75gbMY/qB8oFM2gsQa6H61SilzwZA
Fv97fRheORKkU55+MkIQpiGRqRxOF3yEvJ+M0ejf5lG5Nkc/kLnHvALcWxxPDkjB
JYOcCj+esQMzEhonrPcibCTRAUH4WAP+JWgiH5paPHxsnnVI84HxZmduTILA7rpX
DhjvLpr3Etiga+kFpaHpaPi8TD8SHkXoUsCjvxInebnMMTzD9joiFgOgyY9mpFui
TdaBJQbpdqQACj7LzTWb4OE4y2BThihCQRxEV+ioratF4yUQvNs+ZUH7G6aXD+u5
dHn5HrwdVw1Hr8Mvn4dGp+smWg9WY7ViYG4A++MnESLn/pmPNPW56MORcr3Ywx65
LvKRRFHQV80MNNVIIb/bE/FmJUNS0nAiNs2fxBx1IK1jcmMGDw4nztJqDby1ORrp
0XZ60Vzk50lJLVU3aPAaOpg+VBeHVOmmJ1CJeyAvP/+/oYtKR5j/K3tJPsMpRmAY
QqszKbrAKbkTidOIijlBO8n9pu0f9GBj39ItVQGL
-----END CERTIFICATE-----`;

const tlsAgent = new https.Agent({ ca: [INCOMMON_INTERMEDIATE, SECTIGO_ROOT] });

/**
 * https.request with the custom TLS agent, 3-retry backoff on 429/5xx.
 * Exported so sourceUrlFetch.ts can reuse the exact TLS workaround instead of
 * duplicating the intermediate/root cert PEMs above.
 */
export async function fetchText(url: string): Promise<string> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    lastStatus = 0;
    try {
      return await new Promise<string>((resolve, reject) => {
        https
          .get(url, { agent: tlsAgent, headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } }, (res) => {
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 300) {
              let data = '';
              res.on('data', (c) => (data += c));
              res.on('end', () => resolve(data));
            } else {
              lastStatus = status;
              res.resume();
              reject(new Error(`HTTP ${status}`));
            }
          })
          .on('error', reject);
      });
    } catch (err) {
      if (![429, 502, 503, 504].includes(lastStatus)) throw err;
    }
  }
  throw new Error(`TAMU fetch failed: ${lastStatus}`);
}

export async function ingestTamu(): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  let garagesHtml: string;
  let visitorHtml: string;
  try {
    [garagesHtml, visitorHtml] = await Promise.all([fetchText(TAMU_GARAGES_URL), fetchText(TAMU_VISITOR_URL)]);
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`fetch failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  let garages: ReturnType<typeof extractTamuGarages>;
  let rateText: string | undefined;
  try {
    garages = extractTamuGarages(garagesHtml);
    rateText = extractTamuRateText(visitorHtml);
  } catch (err) {
    return { ingested: 0, skipped: 0, errors: [`parse failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  return ingestTamuGarages(TAMU_GARAGES_URL, garages, rateText, upsertSourcedLocation);
}