/*!
 * KAZAKHSTAN TV 🇰🇿 — plugin for Lampa
 * Version: 1.0.0
 * Catalog of Kazakhstan-produced series. Metadata and posters come from TMDB
 * through Lampa's own TMDB layer (no API keys are stored in this file).
 * This plugin does NOT provide video streams.
 */
(function () {
    'use strict';

    if (window.kazakhstan_tv_lampa_loaded) return;
    window.kazakhstan_tv_lampa_loaded = true;

    var VERSION   = '1.0.0';
    var NAME      = 'KAZAKHSTAN TV 🇰🇿';
    var ORIGIN    = 'KZ';
    var CACHE_KEY = 'kztv_cache_v1';
    var CACHE_TTL = 60 * 60 * 1000; // 1 hour
    var CACHE_MAX = 40;             // max cached requests

    var ICON = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18v12z"/></svg>';

    /* ---------- helpers ---------- */

    function log() {
        try { console.log.apply(console, ['[KZ-TV]'].concat([].slice.call(arguments))); } catch (e) {}
    }

    function noty(text) {
        try { Lampa.Noty.show(text); } catch (e) { log(text); }
    }

    function loader(state) {
        try { Lampa.Activity.loader(state); } catch (e) {}
    }

    function currentController() {
        try { return Lampa.Controller.enabled().name; } catch (e) { return 'content'; }
    }

    function restoreController(name) {
        try { Lampa.Controller.toggle(name || 'content'); } catch (e) {}
    }

    function ruOnly() {
        try {
            var v = Lampa.Storage.get('kztv_ru_only', 'true');
            return v === true || v === 'true';
        } catch (e) { return true; }
    }

    function openLink(url) {
        try {
            if (Lampa.Utils && typeof Lampa.Utils.openLink === 'function') return Lampa.Utils.openLink(url);
        } catch (e) {}
        try {
            if (window.open) return window.open(url, '_blank');
        } catch (e2) {}
        noty('Откройте ссылку вручную: ' + url);
    }

    function yearOf(item) {
        var d = item.first_air_date || item.release_date || '';
        return d ? String(d).slice(0, 4) : '';
    }

    function isKZ(m) {
        if (!m) return false;
        var oc = m.origin_country || [];
        for (var i = 0; i < oc.length; i++) if (oc[i] === ORIGIN) return true;
        var pc = m.production_countries || [];
        for (var j = 0; j < pc.length; j++) if (pc[j].iso_3166_1 === ORIGIN) return true;
        return false;
    }

    /* ---------- TMDB request layer + cache ---------- */

    function tmdbUrl(path) {
        if (!(window.Lampa && Lampa.TMDB && typeof Lampa.TMDB.api === 'function')) return null;
        var u = Lampa.TMDB.api(path);
        function add(s, kv) { return s + (s.indexOf('?') >= 0 ? '&' : '?') + kv; }
        if (u.indexOf('api_key=') < 0 && typeof Lampa.TMDB.key === 'function') {
            var k = Lampa.TMDB.key();
            if (k) u = add(u, 'api_key=' + k);
        }
        if (u.indexOf('language=') < 0) u = add(u, 'language=ru-RU');
        return u;
    }

    function cacheRead() {
        try {
            var c = Lampa.Storage.get(CACHE_KEY, '{}');
            if (typeof c === 'string') c = JSON.parse(c);
            return c && typeof c === 'object' ? c : {};
        } catch (e) { return {}; }
    }

    function cacheWrite(c) {
        try {
            var keys = Object.keys(c);
            if (keys.length > CACHE_MAX) {
                keys.sort(function (a, b) { return c[a].t - c[b].t; });
                for (var i = 0; i < keys.length - CACHE_MAX; i++) delete c[keys[i]];
            }
            Lampa.Storage.set(CACHE_KEY, c);
        } catch (e) { log('cache write failed', e); }
    }

    function clearCache() {
        try { Lampa.Storage.set(CACHE_KEY, {}); noty('Кеш KAZAKHSTAN TV очищен'); } catch (e) {}
    }

    // path example: 'search/tv?query=abc' (no api key here — the cache key is the path only)
    function getJson(path, ok, fail) {
        var cache = cacheRead();
        var hit = cache[path];
        if (hit && Date.now() - hit.t < CACHE_TTL) return ok(hit.d);

        var url = tmdbUrl(path);
        if (!url) { fail('TMDB недоступен в этой версии Lampa'); return; }

        var net = new Lampa.Reguest();
        net.silent(url, function (json) {
            if (!json || typeof json !== 'object') return fail('Пустой ответ сервера');
            var c = cacheRead();
            c[path] = { t: Date.now(), d: json };
            cacheWrite(c);
            ok(json);
        }, function () {
            // network error: use stale cache if we have it
            if (hit) { noty('Нет сети — показаны сохранённые данные'); return ok(hit.d); }
            fail('Ошибка сети. Проверьте интернет и повторите.');
        });
    }

    /* ---------- catalog ---------- */

    function baseQuery(extra) {
        var q = 'with_origin_country=' + ORIGIN + '&include_adult=false';
        if (ruOnly()) q += '&with_original_language=ru';
        return q + (extra ? '&' + extra : '');
    }

    // TMDB TV genre ids: 80 crime, 35 comedy, 18 drama, 10751 family, 10766 soap, 10768 war & politics
    var CATEGORIES = [
        { id: 'popular',  title: '🔥 Популярные в Казахстане', q: function () { return baseQuery('sort_by=popularity.desc'); } },
        { id: 'classic',  title: '🏆 Классика Казахстана',     q: function () { return baseQuery('first_air_date.lte=2009-12-31&sort_by=vote_average.desc&vote_count.gte=3'); } },
        { id: 'old',      title: '📼 Старые казахстанские сериалы', q: function () { return baseQuery('first_air_date.lte=2000-12-31&sort_by=first_air_date.desc'); } },
        { id: 'new',      title: '✨ Новинки',                  q: function () { return baseQuery('first_air_date.gte=' + (new Date().getFullYear() - 1) + '-01-01&sort_by=first_air_date.desc'); } },
        { id: 'crime',    title: '🔎 Криминал',                 q: function () { return baseQuery('with_genres=80&sort_by=popularity.desc'); } },
        { id: 'comedy',   title: '😂 Комедии',                  q: function () { return baseQuery('with_genres=35&sort_by=popularity.desc'); } },
        { id: 'drama',    title: '🎭 Драмы',                    q: function () { return baseQuery('with_genres=18&sort_by=popularity.desc'); } },
        { id: 'history',  title: '🏛 Исторические сериалы',     q: function () { return baseQuery('with_genres=10768&sort_by=popularity.desc'); } },
        { id: 'romance',  title: '❤️ Мелодрамы',                q: function () { return baseQuery('with_genres=10766&sort_by=popularity.desc'); } },
        { id: 'family',   title: '👨‍👩‍👧 Семейные сериалы',        q: function () { return baseQuery('with_genres=10751&sort_by=popularity.desc'); } },
        { id: 'all',      title: '📺 Все сериалы Казахстана',   q: function () { return baseQuery('sort_by=popularity.desc'); } }
    ];

    function openCategory(cat) {
        // Built-in Lampa component: gives posters, rating, year, D-pad navigation and pagination.
        Lampa.Activity.push({
            url: 'discover/tv?' + cat.q(),
            title: cat.title,
            component: 'category_full',
            source: 'tmdb',
            card_type: true,
            page: 1
        });
    }

    function openCard(item) {
        Lampa.Activity.push({
            url: '',
            component: 'full',
            id: item.id,
            method: 'tv',
            card: item,
            source: 'tmdb'
        });
    }

    /* ---------- search ---------- */

    function filterResults(list) {
        var ru = ruOnly();
        return (list || []).filter(function (r) {
            if (!isKZ(r)) return false;
            if (ru && r.original_language !== 'ru') return false;
            return true;
        });
    }

    function runSearch(text, back) {
        text = String(text || '').replace(/^\s+|\s+$/g, '');
        if (!text) return restoreController(back);

        var m = text.match(/(?:^|\s)((?:19|20)\d{2})(?:\s|$)/);
        var year = m ? m[1] : '';
        var title = year ? text.replace(year, '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '') : text;

        loader(true);

        var done = function (results) {
            loader(false);
            results = filterResults(results);
            results.sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); });
            if (!results.length) {
                noty('Ничего не найдено среди сериалов Казахстана');
                return restoreController(back);
            }
            var items = results.slice(0, 40).map(function (r) {
                var y = yearOf(r);
                var sub = [];
                if (r.vote_average) sub.push('★ ' + Number(r.vote_average).toFixed(1));
                if (r.original_name && r.original_name !== r.name) sub.push(r.original_name);
                return { title: (r.name || r.original_name) + (y ? ' (' + y + ')' : ''), subtitle: sub.join(' · '), item: r };
            });
            Lampa.Select.show({
                title: 'Результаты: ' + text,
                items: items,
                onSelect: function (a) { openCard(a.item); },
                onBack: function () { restoreController(back); }
            });
        };
        var fail = function (msg) { loader(false); noty(msg); restoreController(back); };

        if (!title) {
            // only a year was typed
            getJson('discover/tv?' + baseQuery('first_air_date_year=' + year + '&sort_by=popularity.desc'), function (j) { done(j.results); }, fail);
            return;
        }

        var base = 'search/tv?query=' + encodeURIComponent(title) + '&include_adult=false' + (year ? '&first_air_date_year=' + year : '');
        var all = [];
        getJson(base + '&page=1', function (j1) {
            all = all.concat(j1.results || []);
            if ((j1.total_pages || 1) < 2) return done(all);
            getJson(base + '&page=2', function (j2) { done(all.concat(j2.results || [])); }, function () { done(all); });
        }, fail);
    }

    function askSearch(back) {
        var title = 'Поиск: название или год (например: 2020)';
        try {
            if (Lampa.Input && typeof Lampa.Input.edit === 'function') {
                Lampa.Input.edit({ free: true, title: title, nosave: true, value: '' }, function (val) {
                    runSearch(val, back);
                });
                return;
            }
        } catch (e) { log('Input.edit failed', e); }
        var v = window.prompt ? window.prompt(title, '') : '';
        runSearch(v, back);
    }

    /* ---------- hub (section menu) ---------- */

    function showHub() {
        var back = currentController();
        var items = [{ title: '🔎 Поиск по сериалам Казахстана', id: '__search' }];
        CATEGORIES.forEach(function (c) { items.push({ title: c.title, id: c.id }); });

        Lampa.Select.show({
            title: NAME,
            items: items,
            onSelect: function (a) {
                if (a.id === '__search') return askSearch(back);
                for (var i = 0; i < CATEGORIES.length; i++) {
                    if (CATEGORIES[i].id === a.id) return openCategory(CATEGORIES[i]);
                }
            },
            onBack: function () { restoreController(back); }
        });
    }

    /* ---------- official viewing sources (via TMDB watch providers) ---------- */

    function showWatch(movie) {
        var back = currentController();
        loader(true);
        getJson('tv/' + movie.id + '/watch/providers', function (j) {
            loader(false);
            var r = j && j.results && j.results[ORIGIN];
            var items = [];
            if (r) {
                [['flatrate', 'подписка'], ['free', 'бесплатно'], ['ads', 'с рекламой'], ['rent', 'аренда'], ['buy', 'покупка']].forEach(function (g) {
                    (r[g[0]] || []).forEach(function (p) {
                        items.push({ title: p.provider_name, subtitle: g[1], link: r.link });
                    });
                });
            }
            if (!items.length) {
                Lampa.Select.show({
                    title: 'Где смотреть',
                    items: [{ title: 'Официальный источник для Казахстана не найден', subtitle: 'Серия недоступна для просмотра через этот плагин', nothing: true }],
                    onSelect: function () { restoreController(back); },
                    onBack: function () { restoreController(back); }
                });
                return;
            }
            Lampa.Select.show({
                title: 'Где смотреть (Казахстан)',
                items: items,
                onSelect: function (a) { if (a.link) openLink(a.link); else restoreController(back); },
                onBack: function () { restoreController(back); }
            });
        }, function (msg) { loader(false); noty(msg); restoreController(back); });
    }

    function hookFullCard() {
        Lampa.Listener.follow('full', function (e) {
            try {
                if (!e || e.type !== 'complite') return;
                var movie = e.data && e.data.movie;
                if (!movie || !movie.id || !movie.name || !isKZ(movie)) return; // series only

                var render = e.object.activity.render();
                if (render.find('.view--kztv').length) return;

                var btn = $('<div class="full-start__button selector view--kztv"><span>Где смотреть (KZ)</span></div>');
                btn.on('hover:enter', function () { showWatch(movie); });

                var box = render.find('.full-start-new__buttons, .full-start__buttons').eq(0);
                if (box.length) box.append(btn);
            } catch (err) { log('full hook error', err); }
        });
    }

    /* ---------- menu + settings ---------- */

    function addMenu() {
        if (window.kztv_menu_added) return;
        window.kztv_menu_added = true;
        if (Lampa.Menu && typeof Lampa.Menu.addButton === 'function') {
            Lampa.Menu.addButton(ICON, NAME, showHub);
            return;
        }
        // fallback for builds without Menu.addButton
        var li = $('<li class="menu__item selector"><div class="menu__ico">' + ICON + '</div><div class="menu__text">' + NAME + '</div></li>');
        li.on('hover:enter', showHub);
        $('.menu .menu__list').eq(0).append(li);
    }

    function addSettings() {
        try {
            if (!Lampa.SettingsApi) return;
            Lampa.SettingsApi.addComponent({ component: 'kztv', name: NAME, icon: ICON });
            Lampa.SettingsApi.addParam({
                component: 'kztv',
                param: { name: 'kztv_ru_only', type: 'trigger', default: true },
                field: {
                    name: 'Только русскоязычные сериалы',
                    description: 'Оригинальный язык в TMDB — русский. Выключите, чтобы видеть и казахскоязычные'
                }
            });
            Lampa.SettingsApi.addParam({
                component: 'kztv',
                param: { name: 'kztv_clear_cache', type: 'static' },
                field: { name: 'Очистить кеш каталога', description: 'Версия ' + VERSION },
                onRender: function (item) { item.on('hover:enter', clearCache); }
            });
        } catch (e) { log('settings failed', e); }
    }

    function start() {
        try {
            addMenu();
            addSettings();
            hookFullCard();
            log('started v' + VERSION);
        } catch (e) { log('start failed', e); }
    }

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
