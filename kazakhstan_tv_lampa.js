/*!
 * KAZAKHSTAN TV 🇰🇿 — plugin for Lampa
 * Version: 1.0.4
 * Catalog of Kazakhstan-produced series. Metadata and posters come from TMDB
 * through Lampa's own TMDB layer (no API keys are stored in this file).
 * This plugin does NOT provide video streams.
 */
(function () {
    'use strict';

    if (window.kazakhstan_tv_lampa_loaded) return;
    window.kazakhstan_tv_lampa_loaded = true;

    // Wait for Lampa to become available
    function whenLampa(cb, tries) {
        tries = tries || 0;

        if (window.Lampa && Lampa.Listener &&
            typeof Lampa.Listener.follow === 'function') {
            return cb();
        }

        if (tries > 100) {
            try {
                console.log('[KZ-TV] Lampa not found, plugin stopped');
            } catch (e) {}
            return;
        }

        setTimeout(function () {
            whenLampa(cb, tries + 1);
        }, 200);
    }

    var VERSION = '1.0.4';
    var NAME = 'KAZAKHSTAN TV 🇰🇿';
    var ORIGIN = 'KZ';
    var CACHE_KEY = 'kztv_cache_v1';
    var CACHE_TTL = 60 * 60 * 1000;
    var CACHE_MAX = 30;

    var ICON = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18v12z"/></svg>';

    /* ---------- helpers ---------- */

    function log() {
        try {
            console.log.apply(console, ['[KZ-TV]'].concat([].slice.call(arguments)));
        } catch (e) {}
    }

    function noty(text) {
        try {
            Lampa.Noty.show(text);
        } catch (e) {
            log(text);
        }
    }

    function loader(state) {
        try {
            Lampa.Activity.loader(state);
        } catch (e) {}
    }

    function currentController() {
        try {
            return Lampa.Controller.enabled().name;
        } catch (e) {
            return 'content';
        }
    }

    function restoreController(name) {
        try {
            Lampa.Controller.toggle(name || 'content');
        } catch (e) {}
    }

    function ruOnly() {
        try {
            var v = Lampa.Storage.get('kztv_ru_only', 'true');
            return v === true || v === 'true';
        } catch (e) {
            return true;
        }
    }

    function openLink(url) {
        try {
            if (Lampa.Utils &&
                typeof Lampa.Utils.openLink === 'function') {
                return Lampa.Utils.openLink(url);
            }
        } catch (e) {}

        try {
            if (window.open) return window.open(url, '_blank');
        } catch (e2) {}

        noty('Откройте ссылку вручную: ' + url);
    }

    function esc(t) {
        return String(t == null ? '' : t)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function slim(path, json) {
        try {
            if (json && json.results && json.results.map) {
                return {
                    page: json.page,
                    total_pages: json.total_pages,
                    results: json.results.map(function (r) {
                        return {
                            id: r.id,
                            name: r.name,
                            original_name: r.original_name,
                            origin_country: r.origin_country,
                            original_language: r.original_language,
                            first_air_date: r.first_air_date,
                            vote_average: r.vote_average,
                            popularity: r.popularity,
                            poster_path: r.poster_path,
                            backdrop_path: r.backdrop_path,
                            overview: r.overview,
                            genre_ids: r.genre_ids,
                            vote_count: r.vote_count
                        };
                    })
                };
            }
        } catch (e) {}

        return json;
    }

    function yearOf(item) {
        var d = item.first_air_date || item.release_date || '';
        return d ? String(d).slice(0, 4) : '';
    }

    function isKZ(m) {
        if (!m) return false;

        var oc = m.origin_country || [];

        for (var i = 0; i < oc.length; i++) {
            if (oc[i] === ORIGIN) return true;
        }

        var pc = m.production_countries || [];

        for (var j = 0; j < pc.length; j++) {
            if (pc[j].iso_3166_1 === ORIGIN) return true;
        }

        return false;
    }

    /* ---------- TMDB request layer + cache ---------- */

    function tmdbUrl(path) {
        if (!(window.Lampa && Lampa.TMDB &&
            typeof Lampa.TMDB.api === 'function')) {
            return null;
        }

        var u = Lampa.TMDB.api(path);

        function add(s, kv) {
            return s + (s.indexOf('?') >= 0 ? '&' : '?') + kv;
        }

        if (u.indexOf('api_key=') < 0 &&
            typeof Lampa.TMDB.key === 'function') {
            var k = Lampa.TMDB.key();
            if (k) u = add(u, 'api_key=' + k);
        }

        if (u.indexOf('language=') < 0) {
            u = add(u, 'language=ru-RU');
        }

        return u;
    }

    function cacheRead() {
        try {
            var c = Lampa.Storage.get(CACHE_KEY, '{}');

            if (typeof c === 'string') {
                c = JSON.parse(c);
            }

            return c && typeof c === 'object' ? c : {};
        } catch (e) {
            return {};
        }
    }

    function cacheWrite(c) {
        try {
            var keys = Object.keys(c);

            if (keys.length > CACHE_MAX) {
                keys.sort(function (a, b) {
                    return c[a].t - c[b].t;
                });

                for (var i = 0; i < keys.length - CACHE_MAX; i++) {
                    delete c[keys[i]];
                }
            }

            Lampa.Storage.set(CACHE_KEY, c);
        } catch (e) {
            log('cache write failed', e);
        }
    }

    function clearCache() {
        try {
            Lampa.Storage.set(CACHE_KEY, {});
            noty('Кеш KAZAKHSTAN TV очищен');
        } catch (e) {}
    }

    // Protected TMDB request with cache and stale-cache fallback
    function getJson(path, ok, fail) {
        var cache = cacheRead();
        var hit = cache[path];

        if (hit && Date.now() - hit.t < CACHE_TTL) {
            return ok(hit.d);
        }

        var url;

        try {
            url = tmdbUrl(path);
        } catch (e) {
            log('TMDB URL error', e);
            return fail('Ошибка формирования запроса TMDB');
        }

        if (!url) {
            return fail('TMDB недоступен в этой версии Lampa');
        }

        var net;

        try {
            net = new Lampa.Reguest();

            try {
                net.timeout(15000);
            } catch (te) {}

            net.silent(url, function (json) {
                if (!json || typeof json !== 'object') {
                    return fail('Пустой ответ сервера');
                }

                var c = cacheRead();

                c[path] = {
                    t: Date.now(),
                    d: slim(path, json)
                };

                cacheWrite(c);
                ok(json);

            }, function () {
                if (hit) {
                    noty('Нет сети — показаны сохранённые данные');
                    return ok(hit.d);
                }

                fail('Ошибка сети. Проверьте интернет и повторите.');
            });

        } catch (e2) {
            log('TMDB request error', e2);
            fail('Не удалось выполнить запрос TMDB');
        }
    }

    /* ---------- catalog ---------- */

    function baseQuery(extra) {
        var q = 'with_origin_country=' + ORIGIN +
            '&include_adult=false';

        if (ruOnly()) {
            q += '&with_original_language=ru';
        }

        return q + (extra ? '&' + extra : '');
    }

    // TMDB keyword names
    var KW_HISTORY = [
        'historical drama',
        'historical fiction',
        'period drama'
    ];

    var KW_MELODRAMA = [
        'melodrama',
        'romance',
        'forbidden love',
        'love triangle'
    ];

    var KW_KEY = 'kztv_kw_v1';
    var KW_TTL = 7 * 24 * 60 * 60 * 1000;

    var CATEGORIES = [
        {
            id: 'popular',
            title: '🔥 Популярные казахстанские сериалы',
            q: function () {
                return baseQuery('sort_by=popularity.desc');
            }
        },
        {
            id: 'classic',
            title: '🏆 Классика Казахстана',
            q: function () {
                return baseQuery(
                    'first_air_date.lte=2009-12-31&sort_by=vote_average.desc&vote_count.gte=3'
                );
            }
        },
        {
            id: 'old',
            title: '📼 Старые казахстанские сериалы',
            q: function () {
                return baseQuery(
                    'first_air_date.lte=2000-12-31&sort_by=first_air_date.desc'
                );
            }
        },
        {
            id: 'new',
            title: '✨ Новинки',
            q: function () {
                return baseQuery(
                    'first_air_date.gte=' +
                    (new Date().getFullYear() - 1) +
                    '-01-01&sort_by=first_air_date.desc'
                );
            }
        },
        {
            id: 'crime',
            title: '🔎 Криминал',
            q: function () {
                return baseQuery('with_genres=80&sort_by=popularity.desc');
            }
        },
        {
            id: 'comedy',
            title: '😂 Комедии',
            q: function () {
                return baseQuery('with_genres=35&sort_by=popularity.desc');
            }
        },
        {
            id: 'drama',
            title: '🎭 Драмы',
            q: function () {
                return baseQuery('with_genres=18&sort_by=popularity.desc');
            }
        },
        {
            id: 'history',
            title: '🏛 Исторические сериалы',
            keywords: KW_HISTORY,
            q: function (ids) {
                return baseQuery(
                    'with_keywords=' + ids.join('%7C') +
                    '&sort_by=popularity.desc'
                );
            }
        },
        {
            id: 'romance',
            title: '❤️ Мелодрамы',
            keywords: KW_MELODRAMA,
            q: function (ids) {
                return baseQuery(
                    'with_genres=18&with_keywords=' +
                    ids.join('%7C') +
                    '&sort_by=popularity.desc'
                );
            }
        },
        {
            id: 'family',
            title: '👨‍👩‍👧 Семейные сериалы',
            q: function () {
                return baseQuery('with_genres=10751&sort_by=popularity.desc');
            }
        },
        {
            id: 'all',
            title: '📺 Все сериалы Казахстана',
            q: function () {
                return baseQuery('sort_by=popularity.desc');
            }
        }
    ];

    function pushCategory(cat, query) {
        Lampa.Activity.push({
            url: 'discover/tv?' + query,
            title: cat.title,
            component: 'category_full',
            source: 'tmdb',
            card_type: true,
            page: 1
        });
    }

    // Request without catalog cache
    function rawJson(path, ok, fail) {
        var url;

        try {
            url = tmdbUrl(path);
        } catch (e) {
            log('TMDB URL error', e);
            return fail();
        }

        if (!url) return fail();

        var net;

        try {
            net = new Lampa.Reguest();

            try {
                net.timeout(15000);
            } catch (te) {}

            net.silent(url, function (json) {
                ok(json);
            }, function () {
                fail();
            });

        } catch (e2) {
            log('TMDB request error', e2);
            fail();
        }
    }

    function kwRead() {
        try {
            var c = Lampa.Storage.get(KW_KEY, '{}');

            if (typeof c === 'string') {
                c = JSON.parse(c);
            }

            return c && typeof c === 'object' ? c : {};
        } catch (e) {
            return {};
        }
    }

    function resolveKeywords(names, cb) {
        var store = kwRead();
        var now = Date.now();
        var todo = [];

        var fresh = function (e) {
            return !!(e && e.id && now - e.t <= KW_TTL);
        };

        names.forEach(function (n) {
            if (!fresh(store[n])) todo.push(n);
        });

        var finish = function (netFail) {
            var ids = [];

            names.forEach(function (n) {
                if (fresh(store[n])) ids.push(store[n].id);
            });

            cb(ids, netFail);
        };

        if (!todo.length) return finish(false);

        var left = todo.length;
        var failed = false;
        var dirty = false;

        var one = function () {
            left--;

            if (left > 0) return;

            if (dirty) {
                Object.keys(store).forEach(function (k) {
                    if (!store[k] || !store[k].id) {
                        delete store[k];
                    }
                });

                try {
                    Lampa.Storage.set(KW_KEY, store);
                } catch (e) {
                    log('kw cache write failed', e);
                }
            }

            finish(failed);
        };

        todo.forEach(function (name) {
            rawJson(
                'search/keyword?query=' +
                encodeURIComponent(name) +
                '&page=1',

                function (j) {
                    var id = 0;
                    var list = (j && j.results) || [];

                    for (var i = 0; i < list.length; i++) {
                        if (
                            String(list[i].name || '').toLowerCase() === name
                        ) {
                            id = list[i].id;
                            break;
                        }
                    }

                    if (id) {
                        store[name] = {
                            id: id,
                            t: Date.now()
                        };

                        dirty = true;

                    } else if (store[name]) {
                        delete store[name];
                        dirty = true;
                    }

                    one();
                },

                function () {
                    failed = true;
                    one();
                }
            );
        });
    }

    function openCategory(cat) {
        if (!cat.keywords) {
            return pushCategory(cat, cat.q());
        }

        loader(true);

        resolveKeywords(cat.keywords, function (ids, netFail) {
            loader(false);

            if (!ids.length) {
                noty(
                    netFail
                        ? 'Ошибка сети. Не удалось подобрать категорию, повторите позже.'
                        : 'Не удалось подобрать ключевые слова TMDB для этой категории'
                );

                return;
            }

            if (netFail) {
                noty(
                    'Категория загружена не полностью из-за ошибки сети. Откройте её ещё раз позже.'
                );
            }

            pushCategory(cat, cat.q(ids));
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
        text = String(text || '')
            .replace(/^\s+|\s+$/g, '');

        if (!text) return restoreController(back);

        var m = text.match(/(?:^|\s)((?:19|20)\d{2})(?:\s|$)/);
        var year = m ? m[1] : '';

        var title = year
            ? text.replace(year, '')
                .replace(/\s+/g, ' ')
                .replace(/^\s+|\s+$/g, '')
            : text;

        loader(true);

        var done = function (results) {
            loader(false);

            var rawCount = (results || []).filter(isKZ).length;

            results = filterResults(results);

            results.sort(function (a, b) {
                return (b.popularity || 0) - (a.popularity || 0);
            });

            if (!results.length) {
                noty(
                    rawCount && ruOnly()
                        ? 'Найдено сериалов не на русском: ' +
                            rawCount +
                            '. Отключите фильтр в настройках KAZAKHSTAN TV'
                        : 'Ничего не найдено среди сериалов Казахстана'
                );

                return restoreController(back);
            }

            var items = results.slice(0, 40).map(function (r) {
                var y = yearOf(r);
                var sub = [];

                if (r.vote_average) {
                    sub.push('★ ' + Number(r.vote_average).toFixed(1));
                }

                if (r.original_name && r.original_name !== r.name) {
                    sub.push(r.original_name);
                }

                return {
                    title: esc(
                        (r.name || r.original_name) +
                        (y ? ' (' + y + ')' : '')
                    ),
                    subtitle: esc(sub.join(' · ')),
                    item: r
                };
            });

            Lampa.Select.show({
                title: 'Результаты: ' + esc(text),
                items: items,

                onSelect: function (a) {
                    openCard(a.item);
                },

                onBack: function () {
                    restoreController(back);
                }
            });
        };

        var fail = function (msg) {
            loader(false);
            noty(msg);
            restoreController(back);
        };

        if (!title) {
            getJson(
                'discover/tv?' +
                baseQuery(
                    'first_air_date_year=' +
                    year +
                    '&sort_by=popularity.desc'
                ),

                function (j) {
                    done(j.results);
                },

                fail
            );

            return;
        }

        var base =
            'search/tv?query=' +
            encodeURIComponent(title) +
            '&include_adult=false' +
            (year ? '&first_air_date_year=' + year : '');

        var all = [];

        getJson(base + '&page=1', function (j1) {
            all = all.concat(j1.results || []);

            if ((j1.total_pages || 1) < 2) {
                return done(all);
            }

            getJson(
                base + '&page=2',

                function (j2) {
                    done(all.concat(j2.results || []));
                },

                function () {
                    done(all);
                }
            );

        }, fail);
    }

    function askSearch(back) {
        var title = 'Поиск: название или год (например: 2020)';

        try {
            if (Lampa.Input &&
                typeof Lampa.Input.edit === 'function') {

                Lampa.Input.edit({
                    free: true,
                    title: title,
                    nosave: true,
                    value: ''
                }, function (val) {
                    runSearch(val, back);
                });

                return;
            }
        } catch (e) {
            log('Input.edit failed', e);
        }

        var v = window.prompt ? window.prompt(title, '') : '';

        runSearch(v, back);
    }

    /* ---------- hub (section menu) ---------- */

    function showHub() {
        var back = currentController();

        var items = [
            {
                title: '🔎 Поиск по сериалам Казахстана',
                id: '__search'
            }
        ];

        CATEGORIES.forEach(function (c) {
            items.push({
                title: c.title,
                id: c.id
            });
        });

        Lampa.Select.show({
            title: NAME,
            items: items,

            onSelect: function (a) {
                if (a.id === '__search') {
                    return askSearch(back);
                }

                for (var i = 0; i < CATEGORIES.length; i++) {
                    if (CATEGORIES[i].id === a.id) {
                        return openCategory(CATEGORIES[i]);
                    }
                }
            },

            onBack: function () {
                restoreController(back);
            }
        });
    }

    /* ---------- official viewing sources ---------- */

    function showWatch(movie) {
        var back = currentController();

        loader(true);

        getJson(
            'tv/' + movie.id + '/watch/providers',

            function (j) {
                loader(false);

                var r = j && j.results && j.results[ORIGIN];
                var items = [];

                if (r) {
                    [
                        ['flatrate', 'подписка'],
                        ['free', 'бесплатно'],
                        ['ads', 'с рекламой'],
                        ['rent', 'аренда'],
                        ['buy', 'покупка']
                    ].forEach(function (g) {
                        (r[g[0]] || []).forEach(function (p) {
                            items.push({
                                title: esc(p.provider_name),
                                subtitle: g[1],
                                link: r.link
                            });
                        });
                    });
                }

                if (!items.length) {
                    Lampa.Select.show({
                        title: 'Где смотреть',

                        items: [
                            {
                                title: 'Официальный источник для Казахстана не найден',
                                subtitle: 'Серия недоступна для просмотра через этот плагин',
                                nothing: true
                            }
                        ],

                        onSelect: function () {
                            restoreController(back);
                        },

                        onBack: function () {
                            restoreController(back);
                        }
                    });

                    return;
                }

                Lampa.Select.show({
                    title: 'Где смотреть (Казахстан)',
                    items: items,

                    onSelect: function (a) {
                        if (a.link) {
                            openLink(a.link);
                        } else {
                            restoreController(back);
                        }
                    },

                    onBack: function () {
                        restoreController(back);
                    }
                });
            },

            function (msg) {
                loader(false);
                noty(msg);
                restoreController(back);
            }
        );
    }

    function hookFullCard() {
        Lampa.Listener.follow('full', function (e) {
            try {
                if (!e || e.type !== 'complite') return;

                var movie = e.data && e.data.movie;

                if (!movie || !movie.id || !movie.name || !isKZ(movie)) {
                    return;
                }

                var render = e.object.activity.render();

                if (render.find('.view--kztv').length) return;

                var btn = $(
                    '<div class="full-start__button selector view--kztv">' +
                    '<span>Где смотреть (KZ)</span></div>'
                );

                btn.on('hover:enter', function () {
                    showWatch(movie);
                });

                var box = render.find(
                    '.full-start-new__buttons, .full-start__buttons'
                ).eq(0);

                if (!box.length) {
                    box = render.find(
                        '.full-start__button, .full-start-new__button'
                    ).eq(0).parent();
                }

                if (box.length) {
                    box.append(btn);
                } else {
                    log('full card: buttons container not found');
                }

            } catch (err) {
                log('full hook error', err);
            }
        });
    }

    /* ---------- menu + settings ---------- */

    function menuPresent() {
        try {
            return $('.menu [data-kztv="1"]').length > 0;
        } catch (e) {
            return false;
        }
    }

    function addMenuDom() {
        if (menuPresent()) return true;

        var list = $('.menu .menu__list').eq(0);

        if (!list.length) return false;

        var li = $(
            '<li class="menu__item selector" data-kztv="1">' +
            '<div class="menu__ico">' + ICON + '</div>' +
            '<div class="menu__text">' + NAME + '</div></li>'
        );

        li.on('hover:enter', showHub);

        list.append(li);

        return true;
    }

    function addMenu(tries) {
        tries = tries || 0;

        try {
            if (addMenuDom()) {
                log('menu button added (DOM)');
                return;
            }
        } catch (e) {
            log('menu DOM error', e);
        }

        try {
            if (
                tries === 3 &&
                Lampa.Menu &&
                typeof Lampa.Menu.addButton === 'function'
            ) {
                Lampa.Menu.addButton(ICON, NAME, showHub);
                log('menu button added (Menu.addButton)');
            }
        } catch (e2) {
            log('Menu.addButton error', e2);
        }

        if (tries < 40) {
            setTimeout(function () {
                addMenu(tries + 1);
            }, 500);
        } else {
            log('menu list not found after retries');

            noty(
                'KAZAKHSTAN TV: не найдено меню Lampa. Откройте консоль Lampa и пришлите лог [KZ-TV]'
            );
        }
    }

    function addSettings() {
        try {
            if (!Lampa.SettingsApi) return;

            Lampa.SettingsApi.addComponent({
                component: 'kztv',
                name: NAME,
                icon: ICON
            });

            Lampa.SettingsApi.addParam({
                component: 'kztv',

                param: {
                    name: 'kztv_ru_only',
                    type: 'trigger',
                    default: true
                },

                field: {
                    name: 'Только русскоязычные сериалы',
                    description: 'Оригинальный язык в TMDB — русский. Выключите, чтобы видеть и казахскоязычные'
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'kztv',

                param: {
                    name: 'kztv_clear_cache',
                    type: 'static'
                },

                field: {
                    name: 'Очистить кеш каталога',
                    description: 'Версия ' + VERSION
                },

                onRender: function (item) {
                    item.on('hover:enter', clearCache);
                }
            });

        } catch (e) {
            log('settings failed', e);
        }
    }

    var started = false;

    function start() {
        if (started) return;

        started = true;

        try {
            addMenu();
        } catch (e) {
            log('addMenu failed', e);
        }

        try {
            addSettings();
        } catch (e2) {
            log('addSettings failed', e2);
        }

        try {
            hookFullCard();
        } catch (e3) {
            log('hookFullCard failed', e3);
        }

        setInterval(function () {
            try {
                if (!menuPresent()) addMenuDom();
            } catch (e4) {}
        }, 10000);

        log('started v' + VERSION);
    }

    whenLampa(function () {
        log('loaded v' + VERSION + ', appready=' + !!window.appready);

        if (window.appready) {
            start();
        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e && e.type === 'ready') {
                    start();
                }
            });

            setTimeout(function () {
                try {
                    if (!started && $('.menu .menu__list').length) {
                        log('ready event missed, starting by timer');
                        start();
                    }
                } catch (e5) {}
            }, 6000);
        }
    });

})();

