// Kleiner History-Router: Pfadmuster wie '/d/:address', Navigation per pushState, Klicks auf interne Links.

export const route = $state({
    path: window.location.pathname,
    query: new URLSearchParams(window.location.search),
});

function update() {
    route.path = window.location.pathname;
    route.query = new URLSearchParams(window.location.search);
}

export function navigate(to: string, replace = false) {
    if (replace) {
        window.history.replaceState(null, '', to);
    } else {
        window.history.pushState(null, '', to);
    }
    update();
    window.scrollTo({ top: 0 });
}

window.addEventListener('popstate', update);

/** Matches '/explorer/:chain/block/:id' against a path and returns the parameters, or null. */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
    const patternParts = pattern.split('/').filter(p => p.length > 0);
    const pathParts = path.split('/').filter(p => p.length > 0);
    if (patternParts.length !== pathParts.length) {
        return null;
    }
    const params: Record<string, string> = {};
    for (let i = 0; i < patternParts.length; i++) {
        const p = patternParts[i];
        if (p.startsWith(':')) {
            try {
                params[p.slice(1)] = decodeURIComponent(pathParts[i]);
            } catch {
                params[p.slice(1)] = pathParts[i];
            }
        } else if (p !== pathParts[i]) {
            return null;
        }
    }
    return params;
}

/** Click handler for the whole app: internal links navigate without a reload. */
export function handleLinkClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    if (anchor == null || anchor.target === '_blank' || anchor.hasAttribute('download') || anchor.getAttribute('rel') === 'external') {
        return;
    }
    const href = anchor.getAttribute('href');
    if (href == null || !href.startsWith('/') || href.startsWith('//')) {
        return;
    }
    // Rechtstexte liefert Caddy als eigene Seiten aus
    if (/^\/(impressum|datenschutz|nutzungsbedingungen|legal\/)/.test(href)) {
        return;
    }
    event.preventDefault();
    navigate(href);
}
