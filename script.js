// =========================================================
// TWITCH MINER COMMAND CENTER • ULTRA-DENSE 100VW ENGINE
// Multi-Profile Switcher, Every Filter/Sort/Button & Dual Mode
// =========================================================

// --- Formatting Helpers ---
function millify(num, decimals = 1) {
    if (num === null || num === undefined || isNaN(num)) return "0";
    var abs = Math.abs(Number(num));
    if (abs >= 1.0e9) return (num / 1.0e9).toFixed(decimals).replace(/\.0$/, "") + "B";
    if (abs >= 1.0e6) return (num / 1.0e6).toFixed(decimals).replace(/\.0$/, "") + "M";
    if (abs >= 1.0e3) return (num / 1.0e3).toFixed(decimals).replace(/\.0$/, "") + "K";
    return Number(num).toLocaleString();
}

function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return "0";
    return Number(num).toLocaleString();
}

function formatRelativeTime(timestamp) {
    if (!timestamp || timestamp <= 0) return "Never";
    var diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function formatDate(date) {
    if (!date || isNaN(date.getTime()) || date.getTime() === 0) return "";
    var d = new Date(date),
        month = "" + (d.getMonth() + 1),
        day = "" + d.getDate(),
        year = d.getFullYear();

    if (month.length < 2) month = "0" + month;
    if (day.length < 2) day = "0" + day;
    return [year, month, day].join("-");
}

// --- Global State ---
var isStaticMode = (
    window.location.hostname.endsWith("github.io") ||
    window.location.protocol === "file:" ||
    window.location.port === "8089" ||
    window.location.port === "8000" ||
    (!window.location.port && window.location.protocol !== "http:")
);

var currentProfile = localStorage.getItem("selectedProfile") || "all";
var profilesList = [];
var streamersList = [];
var filteredStreamers = [];
var currentStreamer = null;
var currentStreamerRawData = null;
var annotations = [];

// Filters and Sort State
var activeFilter = "all";
var activeTier = "all";
var activeEventFilter = "all";
var searchTerm = "";
var currentSort = "points_desc";

// Avatar Cache (Twitch GQL + DecAPI)
var avatarCache = JSON.parse(localStorage.getItem("twitch_avatars_v2") || "{}");

// Cross-Profile Search State
var crossStreamersDataset = []; // all streamers across all profiles pre-sorted by points desc
var crossProfilesCache = {}; // profId -> streamersList
var crossProfileSearchSort = "points_desc";
var crossProfileFilterProfile = "all";
var latestGlobalSearchResults = [];

// --- Google Sheet Data State & Enriched Targets ---
var sheetDataGlobal = null;
var sheetStreamersMap = {};
var sheetOnlineSet = new Set();

// --- Realtime Twitch Live Status Engine (Direct from Twitch GQL, NOT Twitch Miner) ---
var twitchRealtimeLiveMap = {}; // login -> { isLive: boolean, viewers: number, game: string }
var isCheckingTwitchLive = false;

function isStreamerOnlineRealtime(name) {
    if (!name) return false;
    var login = name.toLowerCase().trim();
    if (twitchRealtimeLiveMap[login] !== undefined) {
        return !!twitchRealtimeLiveMap[login].isLive;
    }
    return false;
}

function getStreamerLiveDetails(name) {
    if (!name) return null;
    var login = name.toLowerCase().trim();
    return twitchRealtimeLiveMap[login] || null;
}

function fetchRealtimeTwitchLiveStatus(callback) {
    if (isCheckingTwitchLive) {
        if (callback) callback();
        return;
    }
    isCheckingTwitchLive = true;

    // Collect all unique streamer logins from current profile and cross profile dataset
    var loginsSet = new Set();
    if (Array.isArray(streamersList)) {
        streamersList.forEach(s => {
            if (s && s.name) loginsSet.add(s.name.toLowerCase().trim());
        });
    }
    if (Array.isArray(crossStreamersDataset)) {
        crossStreamersDataset.forEach(s => {
            if (s && s.name) loginsSet.add(s.name.toLowerCase().trim());
        });
    }

    var allLogins = Array.from(loginsSet).filter(Boolean);
    if (allLogins.length === 0) {
        isCheckingTwitchLive = false;
        if (callback) callback();
        return;
    }

    var chunkSize = 50;
    var chunks = [];
    for (var i = 0; i < allLogins.length; i += chunkSize) {
        chunks.push(allLogins.slice(i, i + chunkSize));
    }

    var promises = chunks.map(chunk => {
        return fetch("https://gql.twitch.tv/gql", {
            method: "POST",
            headers: {
                "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
                "Content-Type": "application/json"
            },
            body: JSON.stringify([{
                query: `query CheckLive($logins: [String!]) {
                    users(logins: $logins) {
                        login
                        stream {
                            id
                            type
                            viewersCount
                            game { name }
                        }
                    }
                }`,
                variables: { logins: chunk }
            }])
        })
        .then(r => r.json())
        .then(data => {
            var users = data && data[0] && data[0].data && data[0].data.users;
            if (Array.isArray(users)) {
                users.forEach(u => {
                    if (!u || !u.login) return;
                    var l = u.login.toLowerCase();
                    if (u.stream && (u.stream.type === "live" || u.stream.id)) {
                        twitchRealtimeLiveMap[l] = {
                            isLive: true,
                            viewers: u.stream.viewersCount || 0,
                            game: (u.stream.game && u.stream.game.name) || ""
                        };
                    } else {
                        twitchRealtimeLiveMap[l] = {
                            isLive: false,
                            viewers: 0,
                            game: ""
                        };
                    }
                });
            }
        })
        .catch(err => {
            console.warn("Twitch GQL live check error:", err);
        });
    });

    Promise.all(promises).then(() => {
        isCheckingTwitchLive = false;
        updateRealtimeLiveUI();
        if (callback) callback();
    }).catch(() => {
        isCheckingTwitchLive = false;
        if (callback) callback();
    });
}

function updateRealtimeLiveUI() {
    var currProfileLiveCount = 0;
    if (Array.isArray(streamersList)) {
        streamersList.forEach(s => {
            s.is_live_now = isStreamerOnlineRealtime(s.name);
            if (s.is_live_now) currProfileLiveCount++;
        });
    }

    var totalRealtimeLiveCount = 0;
    Object.keys(twitchRealtimeLiveMap).forEach(k => {
        if (twitchRealtimeLiveMap[k] && twitchRealtimeLiveMap[k].isLive) {
            totalRealtimeLiveCount++;
        }
    });

    $("#sidebar-live-count").text(currProfileLiveCount);
    $("#sidebar-live-tag").toggle(currProfileLiveCount > 0);
    $("#tab-live-count").text(currProfileLiveCount);
    $("#header-live-badge").text(totalRealtimeLiveCount);

    renderStreamersList();

    if (currentStreamer) {
        var clean = currentStreamer.toLowerCase().trim();
        var isLive = isStreamerOnlineRealtime(clean);
        var liveDetails = getStreamerLiveDetails(clean);
        var $liveTag = $("#spotlight-live-tag");
        if (isLive) {
            var viewText = liveDetails && liveDetails.viewers ? ` • ${liveDetails.viewers.toLocaleString()} viewers` : "";
            var gameText = liveDetails && liveDetails.game ? ` • ${liveDetails.game}` : "";
            $liveTag.removeClass("status-offline").addClass("status-live").html(`<span class="live-dot-pulse-mini"></span> LIVE NOW${viewText}${gameText}`);
            $("#spotlight-sheet-live-tag").show();
        } else {
            $liveTag.removeClass("status-live").addClass("status-offline").html(`<span class="dot"></span> OFFLINE`);
            $("#spotlight-sheet-live-tag").hide();
        }
    }

    if ($("#tab-search").hasClass("active") && latestGlobalSearchResults.length > 0) {
        var query = $("#streamer-search").val().trim().toLowerCase();
        renderCrossProfileSearchResults(latestGlobalSearchResults, query);
    }
    if ($("#tab-matrix").hasClass("active")) {
        renderOverviewMatrix();
    }
}

function loadSheetData(callback) {
    var sheetUrls = isStaticMode
        ? ["sheet_data.json", "assets/sheet_data.json"]
        : ["/sheet_data", "sheet_data.json", "assets/sheet_data.json"];

    tryFetch(sheetUrls, function (data) {
        if (data && data.streamers) {
            sheetDataGlobal = data;
            sheetStreamersMap = {};
            sheetOnlineSet.clear();

            // Populate streamers map (lowercased key)
            Object.keys(data.streamers).forEach(name => {
                var clean = name.toLowerCase().trim();
                sheetStreamersMap[clean] = data.streamers[name];
            });

            // Populate online streamers set
            if (Array.isArray(data.online_streamers)) {
                data.online_streamers.forEach(name => sheetOnlineSet.add(name.toLowerCase().trim()));
            }

            // Enrich currently loaded streamers
            if (streamersList.length > 0) {
                enrichStreamersList(streamersList);
                applySort();
                applyFilters();
                renderChannelsMatrix();
                if (currentStreamer) {
                    var sObj = streamersList.find(s => s.name === currentStreamer);
                    if (sObj) updateSpotlightTargetCard(currentStreamer, sObj.points || 0, sObj);
                }
            }

            // Enrich cross streamers dataset if already loaded
            if (crossStreamersDataset.length > 0) {
                enrichStreamersList(crossStreamersDataset);
            }

            // Query realtime live status from Twitch GQL
            fetchRealtimeTwitchLiveStatus();
        }
        if (callback) callback();
    }, function () {
        console.warn("[gitw] Note: sheet_data.json not yet available.");
        if (callback) callback();
    });
}

function enrichStreamer(s) {
    if (!s) return;
    var nameLower = (s.name || "").toLowerCase().trim();
    var info = sheetStreamersMap[nameLower];
    var pts = s.points || 0;
    var isLiveNow = isStreamerOnlineRealtime(nameLower);

    if (info) {
        s.target_k = info.target_k || 0;
        s.target_points = info.target_points || (s.target_k * 1000);
        s.reward_name = info.reward_name || info.scraped_reward || "";
        s.reward_desc = info.description || "";
        s.hours = info.hours || 0;
        s.ratio = info.ratio || 0;
        s.live_status = isLiveNow ? "Active" : "Offline";
        s.is_live_now = isLiveNow;
    } else {
        s.target_k = s.target_k || 0;
        s.target_points = s.target_points || 0;
        s.reward_name = s.reward_name || "";
        s.reward_desc = s.reward_desc || "";
        s.hours = s.hours || 0;
        s.ratio = s.ratio || 0;
        s.live_status = isLiveNow ? "Active" : "Offline";
        s.is_live_now = isLiveNow;
    }

    if (s.target_points > 0) {
        s.target_pct = Math.round((pts / s.target_points) * 1000) / 10;
        s.is_approaching_target = (s.target_pct >= 70 && s.target_pct < 100);
        s.is_target_met = (s.target_pct >= 100);
    } else {
        s.target_pct = 0;
        s.is_approaching_target = false;
        s.is_target_met = false;
    }
}

function enrichStreamersList(list) {
    if (!Array.isArray(list)) return;
    list.forEach(s => enrichStreamer(s));
}

// Farming Timeline State (5 Styles)
var currentTimelineStyle = 3;
var currentTimelineScope = "24h";
var timelineApexChartInstance = null;
var cachedAllStreamersSeries = {}; // sname -> series array
var computedTimelineSessions = [];
var sessionsByChannelGlobal = {};
var timelineMinTimeGlobal = 0;
var timelineMaxTimeGlobal = 0;

// Timeframe State
var daysAgoSetting = typeof flaskDaysAgo !== "undefined" ? flaskDaysAgo : "inf";
var isAllTime = (daysAgoSetting === "inf" || daysAgoSetting === "infinity" || isNaN(parseInt(daysAgoSetting)));
var startDate = isAllTime ? new Date(0) : new Date(Date.now() - (parseInt(daysAgoSetting) * 86400000));
var endDate = new Date();

// Chart Config
var chartType = "area"; // area or line
var chartCurve = "stepline"; // smooth, straight, stepline
var showAnnotations = true;
var currentAccentColor = localStorage.getItem("accentColor") || "#9146FF";

// Auto Refresh Timer
var autoRefreshTimer = null;
var lastRefreshTime = Date.now();

// --- ApexChart Options ---
var chartOptions = {
    series: [],
    chart: {
        type: "area",
        stacked: false,
        height: 440,
        toolbar: {
            show: true,
            tools: {
                download: true,
                selection: true,
                zoom: true,
                zoomin: true,
                zoomout: true,
                pan: true,
                reset: true
            }
        },
        zoom: {
            type: "x",
            enabled: true,
            autoScaleYaxis: true
        },
        foreColor: "#efeff1",
        background: "transparent",
        animations: { enabled: true, easing: "easeinout", speed: 500 }
    },
    dataLabels: { enabled: false },
    stroke: { curve: "stepline", width: 2.5 },
    markers: { size: 0, hover: { size: 5 } },
    colors: [currentAccentColor],
    fill: {
        type: "gradient",
        gradient: {
            shadeIntensity: 1,
            inverseColors: false,
            opacityFrom: 0.5,
            opacityTo: 0.04,
            stops: [0, 90, 100]
        }
    },
    yaxis: {
        title: { text: "Points", style: { color: "#adadb8", fontSize: "11px" } },
        labels: { formatter: val => millify(val) }
    },
    xaxis: {
        type: "datetime",
        labels: { datetimeUTC: false }
    },
    tooltip: {
        theme: "dark",
        shared: false,
        x: { show: true, format: "dd MMM HH:mm:ss" },
        custom: ({ series, seriesIndex, dataPointIndex, w }) => {
            var val = series[seriesIndex][dataPointIndex];
            var zVal = w.globals.seriesZ && w.globals.seriesZ[seriesIndex] ? w.globals.seriesZ[seriesIndex][dataPointIndex] : "";
            var name = w.globals.seriesNames[seriesIndex];
            return `<div style="padding: 8px 12px; background: #141417; border: 1px solid ${currentAccentColor}; border-radius: 5px; font-size: 12px;">
                <div style="font-weight: 800; color: #fff; margin-bottom: 2px;">${name}</div>
                <div style="color: #efeff1;"><b>Balance:</b> ${formatNumber(val)} pts</div>
                ${zVal ? `<div style="color: #00f59b; font-size: 11px; margin-top: 2px;"><b>Event:</b> ${zVal}</div>` : ""}
            </div>`;
        }
    },
    noData: { text: "Loading channel points...", style: { color: "#9146FF", fontSize: "13px" } }
};

var chart = new ApexCharts(document.querySelector("#chart"), chartOptions);

// --- Document Ready ---
$(document).ready(function () {
    chart.render();

    // Set accent color if saved
    setAccentColor(currentAccentColor);

    // Initial Date inputs
    if (isAllTime) {
        $("#startDate").val("");
    } else {
        $("#startDate").val(formatDate(startDate));
    }
    $("#endDate").val(formatDate(endDate));

    // Restore saved settings
    if (localStorage.getItem("oledTheme") === "true") {
        $("body").addClass("oled-theme");
    }

    // Setup All Event Listeners
    setupEventListeners();

    // Load Google Sheet Details & Targets
    loadSheetData();

    // Load Profiles & Initial Dashboard Data
    loadProfiles();

    // Start Auto-Refresh
    setupAutoRefresh();

    // Keyboard Shortcuts
    $(document).keydown(function (e) {
        // Press '/' to search
        if (e.key === "/" && !$(e.target).is("input, textarea")) {
            e.preventDefault();
            $("#streamer-search").focus();
        }
    });
});

// --- Profile Switcher (Cookies & Analytics) ---
function loadProfiles() {
    var profUrl = isStaticMode ? "profiles.json" : "/profiles";

    // URL deep-linking: ?profile=xyz&channel=abc
    var urlParams = new URLSearchParams(window.location.search);
    var paramProfile = urlParams.get("profile");
    var paramChannel = urlParams.get("channel");

    $.getJSON(profUrl, function (data) {
        if (Array.isArray(data) && data.length > 0) {
            profilesList = data;
            renderProfilesDropdown();

            if (paramProfile && profilesList.some(p => p.id === paramProfile)) {
                currentProfile = paramProfile;
            } else {
                var found = profilesList.find(p => p.id === currentProfile);
                if (!found) {
                    currentProfile = "all";
                }
            }
            updateProfileButton(currentProfile);
        }
        // Load initial dashboard data for active profile
        loadDashboardData(true, function () {
            if (paramChannel) {
                selectStreamer(paramChannel);
            }
        });
    }).fail(function () {
        // Fallback profile if profiles.json missing
        profilesList = [{ id: "all", name: "All Accounts (Combined)", total_points: 0 }];
        if (paramProfile) currentProfile = paramProfile;
        updateProfileButton(currentProfile);
        loadDashboardData(true, function () {
            if (paramChannel) {
                selectStreamer(paramChannel);
            }
        });
    });

    // Eagerly pre-load cross_streamers.json for instant multi-profile search
    preloadCrossStreamersData();
}

function renderProfilesDropdown() {
    var $list = $("#profile-list-scroll");
    $list.empty();
    $("#profile-count-badge").text(profilesList.length - 1); // exclude 'all'

    profilesList.forEach(p => {
        var isAll = p.id === "all";
        var isActive = p.id === currentProfile;
        var activeClass = isActive ? "active" : "";
        var icon = isAll ? "👑" : "👤";
        var ptsText = p.total_points > 0 ? `${millify(p.total_points)} pts` : (p.has_data ? "0 pts" : "Ready");

        var html = `
            <div class="profile-item ${activeClass}" data-profile="${p.id}" onClick="switchProfile('${p.id}')">
                <div class="p-left">
                    <span class="p-icon">${icon}</span>
                    <span class="p-name">${p.name}</span>
                </div>
                <span class="p-pts">${ptsText}</span>
            </div>
        `;
        $list.append(html);
    });
}

function updateProfileButton(profId) {
    var p = profilesList.find(x => x.id === profId) || { name: profId, total_points: 0 };
    $("#current-profile-name").text(p.name);
    $("#current-profile-pts").text(p.total_points > 0 ? `${millify(p.total_points)} pts` : "Active");
}

function switchProfile(profId) {
    currentProfile = profId;
    localStorage.setItem("selectedProfile", currentProfile);
    $("#profile-switcher-container").removeClass("open");
    updateProfileButton(profId);
    $(".profile-item").removeClass("active");
    $(`.profile-item[data-profile='${profId}']`).addClass("active");

    // Reload data for this profile
    loadDashboardData(true);
}

function tryFetch(urls, onSuccess, onAllFailed = null) {
    if (!urls || urls.length === 0) {
        if (onAllFailed) onAllFailed();
        return;
    }
    var url = urls[0];
    $.getJSON(url, function (data) {
        if (data && !data.error) {
            onSuccess(data);
        } else if (urls.length > 1) {
            tryFetch(urls.slice(1), onSuccess, onAllFailed);
        } else if (onAllFailed) {
            onAllFailed();
        }
    }).fail(function () {
        if (urls.length > 1) {
            tryFetch(urls.slice(1), onSuccess, onAllFailed);
        } else if (onAllFailed) {
            onAllFailed();
        }
    });
}

// --- Data Fetching & Multi-Profile Support ---
function loadDashboardData(reselectStreamer = false, callback = null) {
    var isAll = (currentProfile === "all");

    var summaryUrls = [];
    var streamersUrls = [];

    if (isStaticMode) {
        if (!isAll) {
            summaryUrls.push(`analytics/${currentProfile}/summary.json`);
            streamersUrls.push(`analytics/${currentProfile}/streamers.json`);
        }
        summaryUrls.push("summary.json");
        streamersUrls.push("streamers.json");
    } else {
        summaryUrls.push(`/summary?profile=${encodeURIComponent(currentProfile)}`);
        summaryUrls.push(`/summary`);
        streamersUrls.push(`/streamers?profile=${encodeURIComponent(currentProfile)}`);
        streamersUrls.push(`/streamers`);
    }

    // 1. Fetch Summary Metrics
    tryFetch(summaryUrls, function (sData) {
        if (sData) updateKPICards(sData);
    });

    // 2. Fetch Streamers List
    tryFetch(streamersUrls, function (sList) {
        if (Array.isArray(sList) && sList.length > 0) {
            streamersList = sList;
            enrichStreamersList(streamersList);
            applySort();
            applyFilters();
            renderChannelsMatrix();

            // Select streamer
            var saved = localStorage.getItem("selectedStreamer");
            var cand = streamersList.find(s => s.name === saved);
            if (!currentStreamer || reselectStreamer || !cand) {
                currentStreamer = cand ? cand.name : streamersList[0].name;
            }
            selectStreamer(currentStreamer);
        } else {
            streamersList = [];
            filteredStreamers = [];
            renderStreamersList();
            renderChannelsMatrix();
            $("#spotlight-name").text("No channels yet for " + currentProfile);
            chart.updateSeries([]);
        }
        if (callback) callback();
    }, function () {
        streamersList = [];
        filteredStreamers = [];
        renderStreamersList();
        renderChannelsMatrix();
        $("#spotlight-name").text("No channels found");
        chart.updateSeries([]);
        if (callback) callback();
    });
}

function updateKPICards(s) {
    if (!s) return;
    $("#kpi-total-points").text(millify(s.total_points || 0));
    $("#kpi-total-points-raw").text(`${formatNumber(s.total_points || 0)} pts total`);

    var gain = s.gain_24h || 0;
    $("#kpi-24h-gain").text(gain > 0 ? `+${millify(gain)}` : "0");
    $("#kpi-24h-sub").text(gain > 0 ? `+${formatNumber(gain)} pts in 24h` : "No gains in 24h");

    $("#kpi-streamers-count").text(s.streamers_count || 0);
    $("#kpi-active-today").text(`${s.active_today_count || 0} active / farming today`);

    if (s.top_streamer) {
        $("#kpi-top-streamer").text(s.top_streamer.name);
        $("#kpi-top-streamer-points").text(`${millify(s.top_streamer.points || 0)} pts`);
    } else {
        $("#kpi-top-streamer").text("---");
        $("#kpi-top-streamer-points").text("No channels");
    }

    // Estimated farm rate per hour
    var rate = Math.round(gain / 24);
    $("#kpi-farm-rate").text(rate > 0 ? `~${millify(rate)}/hr` : "---");
    $("#kpi-farm-rate-sub").text(rate > 0 ? `~${formatNumber(rate)} pts farmed / hr` : "Awaiting 24h data");

    if (s.last_sync_time) {
        var d = new Date(s.last_sync_time);
        $("#last-sync-time").html(`<i class="far fa-clock"></i> Synced: ${formatRelativeTime(d.getTime())}`);
    }
}

// --- Filters & Sorting ---
function applyFilters() {
    var now_ms = Date.now();
    var ms_24h = 24 * 3600 * 1000;

    filteredStreamers = streamersList.filter(s => {
        // 1. Text Search filter
        if (searchTerm && !s.name.toLowerCase().includes(searchTerm)) {
            return false;
        }

        // 2. Tab Filter
        if (activeFilter === "online") {
            var isLiveStream = isStreamerOnlineRealtime(s.name);
            if (!isLiveStream) return false;
        }
        if (activeFilter === "near_target") {
            if (!s.is_approaching_target && (s.target_pct < 70 || s.target_pct >= 100)) return false;
        }
        if (activeFilter === "target_met") {
            if (!s.is_target_met && s.target_pct < 100) return false;
        }
        if (activeFilter === "active" && !s.active_today && (now_ms - (s.last_activity || 0)) > ms_24h) {
            return false;
        }
        if (activeFilter === "gained" && (!s.gain_24h || s.gain_24h <= 0)) {
            return false;
        }
        if (activeFilter === "idle" && s.gain_24h && s.gain_24h > 0) {
            return false;
        }

        // 3. Point Tier Filter
        var pts = s.points || 0;
        if (activeTier === "1m" && pts < 1000000) return false;
        if (activeTier === "500k" && (pts < 500000 || pts >= 1000000)) return false;
        if (activeTier === "100k" && (pts < 100000 || pts >= 500000)) return false;
        if (activeTier === "sub100k" && pts >= 100000) return false;

        return true;
    });

    // Slice for top X
    if (activeFilter === "top5") filteredStreamers = filteredStreamers.slice(0, 5);
    else if (activeFilter === "top10") filteredStreamers = filteredStreamers.slice(0, 10);
    else if (activeFilter === "top25") filteredStreamers = filteredStreamers.slice(0, 25);

    $("#match-counter").text(`${filteredStreamers.length} / ${streamersList.length}`);
    $("#streamers-count-badge").text(filteredStreamers.length);
    renderStreamersList();
}

function applySort() {
    var [field, dir] = currentSort.split("_");
    var isAsc = (dir === "asc");

    streamersList.sort((a, b) => {
        var va, vb;
        if (field === "points") { va = a.points || 0; vb = b.points || 0; }
        else if (field === "proximity") { va = a.target_pct || 0; vb = b.target_pct || 0; }
        else if (field === "target") { va = a.target_points || 0; vb = b.target_points || 0; }
        else if (field === "live") {
            va = isStreamerOnlineRealtime(a.name) ? 1 : 0;
            vb = isStreamerOnlineRealtime(b.name) ? 1 : 0;
        }
        else if (field === "gain") { va = a.gain_24h || 0; vb = b.gain_24h || 0; }
        else if (field === "gain_total") { va = a.gain_total || 0; vb = b.gain_total || 0; }
        else if (field === "activity") { va = a.last_activity || 0; vb = b.last_activity || 0; }
        else if (field === "events") { va = a.events_count || 0; vb = b.events_count || 0; }
        else if (field === "streaks") { va = a.breakdown ? a.breakdown.Streak : 0; vb = b.breakdown ? b.breakdown.Streak : 0; }
        else if (field === "claims") { va = a.breakdown ? a.breakdown.Claim : 0; vb = b.breakdown ? b.breakdown.Claim : 0; }
        else if (field === "name") {
            return isAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
        }
        return isAsc ? (va - vb) : (vb - va);
    });

    // Update sidebar tag
    var tagText = $("#sort-select option:selected").text().split("(")[0].trim() + (isAsc ? " ↑" : " ↓");
    $("#sidebar-sort-tag").text(tagText);
}

// --- Render Channels Sidebar List ---
function renderStreamersList() {
    var $ul = $("#streamers-list");
    $ul.empty();

    if (filteredStreamers.length === 0) {
        $ul.html('<li class="loading-state">No matching channels found.</li>');
        return;
    }

    var now_ms = Date.now();
    var ms_24h = 24 * 3600 * 1000;

    filteredStreamers.forEach((s, idx) => {
        var isActive = currentStreamer === s.name;
        var activeClass = isActive ? "active" : "";
        var isStreamOnline = isStreamerOnlineRealtime(s.name);
        var isOnline = isStreamOnline || s.active_today || (now_ms - (s.last_activity || 0)) <= ms_24h;
        var dotClass = isStreamOnline ? "live-dot-pulse" : (isOnline ? "active" : "");
        var liveBadge = isStreamOnline ? '<span class="li-live-tag">LIVE</span>' : '';
        var gainText = (s.gain_24h && s.gain_24h > 0) ? `+${millify(s.gain_24h)}` : "--";

        // Reward Name Hover Hint
        var sNameClean = (s.name || "").toLowerCase().trim();
        var sSheet = sheetStreamersMap[sNameClean] || {};
        var sRewardName = s.reward_name || sSheet.reward_name || sSheet.scraped_reward || "";
        var sTargetK = s.target_k || sSheet.target_k || 0;
        var sRewardDesc = s.reward_desc || sSheet.description || "";
        var sRewardHint = sRewardName ? `${s.name} • Reward: ${sRewardName}${sTargetK ? ' (' + sTargetK + 'K target)' : ''}${sRewardDesc ? ' - ' + sRewardDesc : ''}` : s.name;
        var sPtsTooltip = `Current Balance: ${formatNumber(s.points || 0)} pts • Total Farmed: +${formatNumber(s.gain_total || 0)} pts • 24h Farmed: ${gainText}${sRewardName ? ' • Target Reward: ' + sRewardName : ''}`;

        // Target Proximity & Clean Badges (no cringe highlights)
        var highlightClass = "";
        var pillHtml = "";
        var trackHtml = "";
        var targetPct = s.target_pct || 0;

        if (s.is_target_met) {
            highlightClass = "";
            pillHtml = `<span class="li-target-pill pill-met" title="Target met (${s.target_k}K target • ${sRewardName})">${targetPct}%</span>`;
            trackHtml = `<div class="li-target-track"><div class="li-target-fill fill-met" style="width: 100%"></div></div>`;
        } else if (s.is_approaching_target) {
            highlightClass = (s.name === "olofmeister") ? "" : "near-target-approx";
            pillHtml = `<span class="li-target-pill pill-near" title="Approximating Target! (${targetPct}% of ${s.target_k}K target • ${sRewardName})">🎯 ${targetPct}%</span>`;
            trackHtml = `<div class="li-target-track"><div class="li-target-fill fill-near" style="width: ${Math.min(100, targetPct)}%"></div></div>`;
        } else if (s.target_points > 0) {
            pillHtml = `<span class="li-target-pill pill-progress" title="${targetPct}% of ${s.target_k}K target • ${sRewardName}">${targetPct}%</span>`;
            trackHtml = `<div class="li-target-track"><div class="li-target-fill fill-normal" style="width: ${Math.min(100, targetPct)}%"></div></div>`;
        } else {
            pillHtml = `<span class="li-target-pill pill-progress" title="${sRewardName ? 'Reward: ' + sRewardName : 'No sheet target'}">--</span>`;
        }

        var li = `
            <li class="channel-li ${activeClass} ${highlightClass}" id="ch-item-${s.name}" onClick="selectStreamer('${s.name}')" title="${sRewardHint}">
                <span class="li-rank">${idx + 1}</span>
                <div class="li-name-wrap">
                    <span class="${isStreamOnline ? 'live-dot-pulse' : 'status-dot ' + dotClass}" title="${isStreamOnline ? '🔴 STREAMING LIVE NOW' : (isOnline ? 'Active today' : 'Offline')}"></span>
                    <span class="li-name" title="${sRewardHint}">${s.name}</span>
                    ${liveBadge}
                </div>
                <div class="li-target-wrap">
                    ${pillHtml}
                    ${trackHtml}
                </div>
                <span class="li-gain" title="24h Farmed: ${gainText}">${gainText}</span>
                <span class="li-pts" title="${sPtsTooltip}">${millify(s.points || 0)}</span>
            </li>
        `;
        $ul.append(li);
    });

    if (currentStreamer) {
        var el = document.getElementById(`ch-item-${currentStreamer}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
}

// --- Real Twitch Avatar Engine ---
function getTwitchAvatar(channelName, callback) {
    if (!channelName) return;
    var login = channelName.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!login) return;

    var cached = avatarCache[login];
    var now = Date.now();
    if (cached && cached.url && (now - (cached.ts || 0)) < 7 * 86400000) {
        callback(cached.url);
        return;
    }

    // 1. Unauthenticated Twitch GQL query
    fetch("https://gql.twitch.tv/gql", {
        method: "POST",
        headers: {
            "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
            "Content-Type": "application/json"
        },
        body: JSON.stringify([{
            query: "query($login: String!) { user(login: $login) { profileImageURL(width: 150) } }",
            variables: { login: login }
        }])
    })
    .then(r => r.json())
    .then(data => {
        var url = data[0]?.data?.user?.profileImageURL;
        if (url) {
            avatarCache[login] = { url: url, ts: now };
            try { localStorage.setItem("twitch_avatars_v2", JSON.stringify(avatarCache)); } catch (e) {}
            callback(url);
        } else {
            // DecAPI fallback
            fetch(`https://decapi.me/twitch/avatar/${login}`)
                .then(r => r.text())
                .then(dUrl => {
                    if (dUrl && dUrl.startsWith("http")) {
                        avatarCache[login] = { url: dUrl.trim(), ts: now };
                        try { localStorage.setItem("twitch_avatars_v2", JSON.stringify(avatarCache)); } catch (e) {}
                        callback(dUrl.trim());
                    }
                }).catch(() => {});
        }
    })
    .catch(() => {
        fetch(`https://decapi.me/twitch/avatar/${login}`)
            .then(r => r.text())
            .then(dUrl => {
                if (dUrl && dUrl.startsWith("http")) {
                    avatarCache[login] = { url: dUrl.trim(), ts: now };
                    try { localStorage.setItem("twitch_avatars_v2", JSON.stringify(avatarCache)); } catch (e) {}
                    callback(dUrl.trim());
                }
            }).catch(() => {});
    });
}

function updateSpotlightAvatar(channelName) {
    var $img = $("#spotlight-avatar-img");
    var $ph = $("#spotlight-avatar-placeholder");

    $img.hide();
    $ph.show();

    getTwitchAvatar(channelName, function (url) {
        if (url) {
            $img.attr("src", url);
            $img.off("load error").on("load", function () {
                $img.show();
                $ph.hide();
            }).on("error", function () {
                $img.hide();
                $ph.show();
            });
        }
    });
}

// --- Render Selected Streamer Details & Chart ---
function selectStreamer(streamerName) {
    if (!streamerName) return;
    currentStreamer = streamerName;
    localStorage.setItem("selectedStreamer", currentStreamer);

    // Update active highlight
    $(".channel-li").removeClass("active");
    $(`#ch-item-${streamerName}`).addClass("active");

    var cleanName = streamerName.replace(".json", "");
    var isAll = (currentProfile === "all");

    // Fetch and display real avatar
    updateSpotlightAvatar(cleanName);

    var urlsToTry = [];
    if (isStaticMode) {
        if (!isAll) {
            urlsToTry.push(`analytics/${currentProfile}/${cleanName}.json`);
            urlsToTry.push(`analytics/${currentProfile}/data/${cleanName}.json`);
        }
        urlsToTry.push(`data/${cleanName}.json`);
    } else {
        urlsToTry.push(`/json/${cleanName}?profile=${encodeURIComponent(currentProfile)}`);
        urlsToTry.push(`/json/${cleanName}`);
    }

    tryFetch(urlsToTry, function (resp) {
        if (resp && !resp.error) {
            currentStreamerRawData = resp;
            updateSpotlightBanner(cleanName, resp);
            renderChartData();
            renderEventsFeed(cleanName, resp);
        }
    });
}

function updateSpotlightBanner(name, data) {
    var meta = streamersList.find(s => s.name === name) || {};
    var series = data.series || [];

    var currentPts = series.length > 0 ? series[series.length - 1].y : (meta.points || 0);
    var startPts = series.length > 0 ? series[0].y : (meta.start_points || currentPts);
    var totalGain = Math.max(0, currentPts - startPts);
    var lastActive = series.length > 0 ? series[series.length - 1].x : (meta.last_activity || 0);

    var cleanNameLower = name.toLowerCase().trim();
    var sSheet = sheetStreamersMap[cleanNameLower] || {};
    var sRewardName = meta.reward_name || sSheet.reward_name || sSheet.scraped_reward || "";
    var sTargetK = meta.target_k || sSheet.target_k || 0;
    var sRewardDesc = meta.reward_desc || sSheet.description || "";
    var sRewardHint = sRewardName ? `${name} • Reward: ${sRewardName}${sTargetK ? ' (' + sTargetK + 'K target)' : ''}${sRewardDesc ? ' - ' + sRewardDesc : ''}` : name;

    $("#spotlight-name").text(name).attr("title", sRewardHint);
    $("#spotlight-url").attr("href", `https://twitch.tv/${name}`);
    $("#btn-external-twitch").attr("href", `https://twitch.tv/${name}`);

    $("#spotlight-points").html(`<i class="fas fa-coins"></i> ${formatNumber(currentPts)} pts`);
    $("#spotlight-gain-24h").html(`<i class="fas fa-arrow-up"></i> +${formatNumber(meta.gain_24h || 0)} 24h`);
    $("#spotlight-gain-total").html(`<i class="fas fa-history"></i> +${formatNumber(totalGain)} all-time`);
    $("#spotlight-last-active").html(`<i class="far fa-clock"></i> ${formatRelativeTime(lastActive)}`);
    // Live tag (realtime checked from Twitch)
    var cleanNameLower = name.toLowerCase().trim();
    var isLiveNow = isStreamerOnlineRealtime(cleanNameLower);
    var liveDetails = getStreamerLiveDetails(cleanNameLower);
    var $liveTag = $("#spotlight-live-tag");
    $liveTag.show();
    if (isLiveNow) {
        var viewText = liveDetails && liveDetails.viewers ? ` • ${liveDetails.viewers.toLocaleString()} viewers` : "";
        var gameText = liveDetails && liveDetails.game ? ` • ${liveDetails.game}` : "";
        $liveTag.removeClass("status-offline").addClass("status-live").html(`<span class="live-dot-pulse-mini"></span> LIVE NOW${viewText}${gameText}`);
        $("#spotlight-sheet-live-tag").show();
    } else {
        $liveTag.removeClass("status-live").addClass("status-offline").html(`<span class="dot"></span> OFFLINE`);
        $("#spotlight-sheet-live-tag").hide();
    }

    // Breakdown Counters
    var bd = meta.breakdown || { Watch: 0, Claim: 0, Streak: 0, Raid: 0, Prediction: 0 };
    if (!meta.breakdown && series.length > 0) {
        bd = { Watch: 0, Claim: 0, Streak: 0, Raid: 0, Prediction: 0 };
        series.forEach(pt => {
            var z = (pt.z || "").toLowerCase();
            if (z.includes("watch")) bd.Watch++;
            else if (z.includes("claim")) bd.Claim++;
            else if (z.includes("streak")) bd.Streak++;
            else if (z.includes("raid")) bd.Raid++;
            else if (z.includes("prediction") || z.includes("win") || z.includes("lose")) bd.Prediction++;
        });
    }

    $("#bd-watch").text(formatNumber(bd.Watch || 0));
    $("#bd-claim").text(formatNumber(bd.Claim || 0));
    $("#bd-streak").text(formatNumber(bd.Streak || 0));
    $("#bd-raid").text(formatNumber(bd.Raid || 0));
    $("#bd-prediction").text(formatNumber(bd.Prediction || 0));

    // Update Google Sheet Target & Reward Proximity Card
    updateSpotlightTargetCard(name, currentPts, meta);
}

function updateSpotlightTargetCard(name, currentPts, meta) {
    var $card = $("#spotlight-target-card");
    var clean = name.toLowerCase().trim();
    var sheetInfo = sheetStreamersMap[clean] || {};
    var targetPoints = meta.target_points || sheetInfo.target_points || ((sheetInfo.target_k || 0) * 1000);
    var targetK = meta.target_k || sheetInfo.target_k || 0;
    var rewardName = meta.reward_name || sheetInfo.reward_name || sheetInfo.scraped_reward || "";
    var desc = meta.reward_desc || sheetInfo.description || "";
    var isLive = isStreamerOnlineRealtime(clean);
    var hours = meta.hours || sheetInfo.hours || 0;
    var ratio = meta.ratio || sheetInfo.ratio || 0;

    if (isLive) {
        $("#spotlight-sheet-live-tag").show();
    } else {
        $("#spotlight-sheet-live-tag").hide();
    }

    if (!targetPoints && !rewardName && !targetK && !sheetInfo.row_index) {
        $card.hide();
        return;
    }

    $card.show();
    $card.removeClass("near-target target-met");

    var pct = targetPoints > 0 ? (Math.round((currentPts / targetPoints) * 1000) / 10) : 0;
    var isApproaching = (pct >= 70 && pct < 100);
    var isMet = (pct >= 100);

    var $proxTag = $("#spotlight-proximity-tag");
    $proxTag.removeClass("near met normal");

    var $progFill = $("#spotlight-prog-fill");
    $progFill.removeClass("near met");

    var gainTotal = meta.gain_total;
    if (gainTotal === undefined || gainTotal === null) {
        if (meta.summary && meta.summary.gain_total !== undefined) {
            gainTotal = meta.summary.gain_total;
        } else if (meta.start_points !== undefined && currentPts >= meta.start_points) {
            gainTotal = currentPts - meta.start_points;
        } else {
            gainTotal = 0;
        }
    }

    if (isMet) {
        $card.addClass("target-met");
        $proxTag.addClass("met").html(`🏆 READY TO CLAIM (${pct}%)`);
        $progFill.addClass("met").css("width", "100%");
        $("#tp-meta-status").html(`🎉 <b>Target Reached!</b> Farmed +${formatNumber(gainTotal)} pts • Current Balance: ${formatNumber(currentPts)} / ${formatNumber(targetPoints)} pts (+${formatNumber(currentPts - targetPoints)} surplus)`);
    } else if (isApproaching) {
        $card.addClass("near-target");
        $proxTag.addClass("near").html(`🎯 NEAR TARGET (${pct}%)`);
        $progFill.addClass("near").css("width", `${Math.min(100, pct)}%`);
        $("#tp-meta-status").html(`🔥 <b>Approaching Target!</b> Farmed +${formatNumber(gainTotal)} pts • Only ${formatNumber(targetPoints - currentPts)} points needed to reach ${formatNumber(targetPoints)} pts`);
    } else {
        $proxTag.addClass("normal").html(`${pct}% PROXIMITY`);
        $progFill.css("width", `${Math.min(100, pct)}%`);
        $("#tp-meta-status").html(`Farmed +${formatNumber(gainTotal)} pts • Current Balance: ${formatNumber(currentPts)} / ${formatNumber(targetPoints)} pts`);
    }

    $("#spotlight-reward-name").text(rewardName || "Channel Points Reward").attr("title", rewardName ? `Reward: ${rewardName}` : "");
    if (desc) {
        $("#spotlight-reward-desc").text(`"${desc}"`).show();
    } else {
        $("#spotlight-reward-desc").hide();
    }

    $("#tm-target-points").text(formatNumber(targetPoints) + " pts");
    $("#tm-target-k").text(targetK ? `${targetK}K Target` : "Custom Target");

    $("#tm-farmed-points").text("+" + formatNumber(gainTotal) + " pts");
    $("#tm-farmed-k").text(`${(gainTotal / 1000).toFixed(1)}K Farmed`);

    $("#tm-current-points").text(formatNumber(currentPts) + " pts");
    $("#tm-balance-k").text(`${(currentPts / 1000).toFixed(1)}K Balance`);

    var needed = Math.max(0, targetPoints - currentPts);
    if (isMet) {
        $("#tm-needed-points").html(`+${formatNumber(currentPts - targetPoints)} pts`);
        $("#tm-eta-text").text("Ready to redeem!");
    } else {
        $("#tm-needed-points").text(`${formatNumber(needed)} pts`);
        var dailyRate = meta.gain_24h || (currentPts > 0 ? Math.round(currentPts / 30) : 450);
        if (dailyRate > 0) {
            var daysLeft = (needed / dailyRate).toFixed(1);
            $("#tm-eta-text").text(`~${daysLeft}d at +${millify(dailyRate)}/day`);
        } else {
            $("#tm-eta-text").text("Awaiting 24h gain");
        }
    }

    $("#tm-stream-hours").text(hours > 0 ? `${hours} hrs (7d)` : "-- hrs");
    $("#tm-stream-ratio").text(ratio > 0 ? `${Number(ratio).toFixed(2)} ratio` : "-- ratio");
    $("#tp-meta-pct").text(`${pct}%`);

    $("#spotlight-sheet-live-tag").toggle(isLive);
    if (isLive) {
        $("#spotlight-live-tag").html(`<span class="live-dot-pulse-mini"></span> LIVE ON TWITCH`).show();
    }
}

function sanitizeSeriesForChart(rawSeries) {
    if (!rawSeries || rawSeries.length <= 1) return rawSeries || [];
    var sorted = rawSeries.slice().sort((a, b) => (a.x || 0) - (b.x || 0));
    var cleaned = [sorted[sorted.length - 1]];
    for (var i = sorted.length - 2; i >= 0; i--) {
        var pt = sorted[i];
        var anchor = cleaned[cleaned.length - 1];
        var diff = anchor.y - pt.y;
        if (diff >= -500 && diff <= 30000) {
            cleaned.push(pt);
        }
    }
    cleaned.reverse();
    return cleaned;
}

function renderChartData() {
    if (!currentStreamerRawData || !currentStreamer) return;

    var startMs = (startDate && !isNaN(startDate.getTime())) ? startDate.getTime() : 0;
    var endMs = (endDate && !isNaN(endDate.getTime())) ? new Date(endDate).setHours(23, 59, 59, 999) : Infinity;

    var rawSeries = sanitizeSeriesForChart(currentStreamerRawData.series || []);
    var filtered = rawSeries.filter(pt => pt.x >= startMs && pt.x <= endMs);

    // Baseline straight line if no stream
    if (filtered.length === 0 && rawSeries.length > 0) {
        var lastVal = rawSeries[rawSeries.length - 1].y;
        filtered = [
            { x: startMs || rawSeries[0].x, y: lastVal, z: "No Stream" },
            { x: endMs !== Infinity ? endMs : Date.now(), y: lastVal, z: "No Stream" }
        ];
    }

    var chartData = filtered.map(pt => ({
        x: pt.x,
        y: pt.y,
        z: pt.z || "Watch"
    }));

    chart.updateOptions({
        chart: { type: chartType },
        stroke: { curve: chartCurve, width: 2.5 },
        title: {
            text: `${currentStreamer} • Points Progression (${formatNumber(filtered.length)} points)`,
            align: "left",
            style: { color: currentAccentColor, fontSize: "14px", fontWeight: "800" }
        }
    });

    chart.updateSeries([
        {
            name: currentStreamer,
            data: chartData
        }
    ], true);

    // Annotations
    clearAnnotations();
    if (showAnnotations) {
        var rawAnn = currentStreamerRawData.annotations || [];
        annotations = rawAnn.filter(a => a.x >= startMs && a.x <= endMs);
        updateAnnotations();
    }
}

function updateAnnotations() {
    clearAnnotations();
    if (showAnnotations && annotations.length > 0) {
        annotations.forEach((ann, idx) => {
            ann["id"] = `ann-${idx}`;
            chart.addXaxisAnnotation(ann, true);
        });
    }
}

function clearAnnotations() {
    if (annotations && annotations.length > 0) {
        annotations.forEach(a => {
            if (a.id) chart.removeAnnotation(a.id);
        });
    }
    chart.clearAnnotations();
}

// --- Render Live Activity Feed (Drawer Tab 1) ---
function renderEventsFeed(streamerName, data) {
    var $tbody = $("#events-table-body");
    var series = sanitizeSeriesForChart(data.series || []);

    if (series.length === 0) {
        $tbody.html('<tr><td colspan="6" class="empty-cell">No event points found.</td></tr>');
        return;
    }

    var filteredEvents = series.slice().reverse();

    if (activeEventFilter !== "all") {
        filteredEvents = filteredEvents.filter(pt => {
            var z = (pt.z || "").toLowerCase();
            return z.includes(activeEventFilter);
        });
    }

    var top50 = filteredEvents.slice(0, 50);
    var rows = "";

    top50.forEach((item, idx) => {
        var nextItem = (idx < top50.length - 1) ? top50[idx + 1] : null;
        var diff = nextItem ? (item.y - nextItem.y) : 0;
        var diffHtml = diff > 0
            ? `<span class="event-pts-plus">+${formatNumber(diff)}</span>`
            : (diff < 0 ? `<span class="event-pts-minus">${formatNumber(diff)}</span>` : "--");

        var eventTime = new Date(item.x).toLocaleString();
        var reason = item.z || "Watch";

        rows += `
            <tr>
                <td><small>${eventTime}</small></td>
                <td><b>${streamerName}</b></td>
                <td><span class="tag-reason">${reason}</span></td>
                <td>${diffHtml}</td>
                <td><b>${formatNumber(item.y)}</b></td>
                <td><small class="text-sub">${item.z ? 'Automated ' + item.z : 'Farmed'}</small></td>
            </tr>
        `;
    });

    $tbody.html(rows);
    $("#events-count-tag").text(`Showing ${top50.length} of ${filteredEvents.length} events`);
}

// --- Render Channels Matrix Table (Drawer Tab 2) ---
function renderChannelsMatrix() {
    var $tbody = $("#matrix-table-body");
    if (streamersList.length === 0) {
        $tbody.html('<tr><td colspan="11" class="empty-cell">No channels available.</td></tr>');
        return;
    }

    var rows = "";
    streamersList.forEach((s, idx) => {
        var lastAct = s.last_activity ? formatRelativeTime(s.last_activity) : "--";
        var isOnline = isStreamerOnlineRealtime(s.name);
        var progClass = s.is_target_met ? "met" : (s.is_approaching_target ? "near" : "normal");
        var rowClass = s.is_approaching_target ? "row-near-target" : "";
        var progLabel = s.target_points > 0 ? `${s.target_pct}%` : "--";

        var sNameClean = (s.name || "").toLowerCase().trim();
        var sSheet = sheetStreamersMap[sNameClean] || {};
        var sRewardName = s.reward_name || sSheet.reward_name || sSheet.scraped_reward || "";
        var sTargetK = s.target_k || sSheet.target_k || 0;
        var sRewardDesc = s.reward_desc || sSheet.description || "";
        var sRewardHint = sRewardName ? `${s.name} • Reward: ${sRewardName}${sTargetK ? ' (' + sTargetK + 'K target)' : ''}${sRewardDesc ? ' - ' + sRewardDesc : ''}` : s.name;

        rows += `
            <tr class="${rowClass}">
                <td><b>#${idx + 1}</b></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="${isOnline ? 'live-dot-pulse' : 'status-dot'}" title="${isOnline ? 'Streaming Live' : 'Offline'}"></span>
                        <b title="${sRewardHint}" style="cursor: pointer;" onClick="selectStreamer('${s.name}')">${s.name}</b>
                    </div>
                </td>
                <td>
                    <span class="matrix-live-pill ${isOnline ? 'online' : 'offline'}">
                        ${isOnline ? '<span class="live-dot-pulse-mini"></span> LIVE' : 'Offline'}
                    </span>
                </td>
                <td>
                    <span title="${s.reward_desc || ''}" style="font-weight: 700; color: var(--text-bright);">${s.reward_name || '--'}</span>
                </td>
                <td>
                    <span style="font-weight: 800; color: var(--gold);">${s.target_k ? (s.target_k + "K") : "--"}</span>
                </td>
                <td>
                    <div class="matrix-prog-wrap">
                        <div class="matrix-prog-bar">
                            <div class="matrix-prog-fill ${progClass}" style="width: ${Math.min(100, s.target_pct || 0)}%"></div>
                        </div>
                        <div class="matrix-prog-label">
                            <span style="font-weight: 800; color: ${s.is_target_met ? 'var(--gold)' : (s.is_approaching_target ? 'var(--green)' : 'var(--text-sub)')}">${progLabel}</span>
                            <span style="color: var(--text-muted); font-size: 8px;">${s.target_points > 0 ? millify(s.target_points) : ''}</span>
                        </div>
                    </div>
                </td>
                <td><span class="metric-pill pill-purple">${formatNumber(s.points || 0)}</span></td>
                <td><span class="text-green">+${formatNumber(s.gain_24h || 0)}</span></td>
                <td><span class="text-blue">+${formatNumber(s.gain_total || 0)}</span></td>
                <td><small>${lastAct}</small></td>
                <td>
                    <button class="btn-xs btn-twitch" onClick="selectStreamer('${s.name}')">View Channel</button>
                </td>
            </tr>
        `;
    });
    $tbody.html(rows);
}

// --- Navigation Buttons (Prev / Next / Random) ---
function navigateStreamer(direction) {
    if (filteredStreamers.length === 0) return;
    var idx = filteredStreamers.findIndex(s => s.name === currentStreamer);
    var newIdx = 0;

    if (direction === "prev") {
        newIdx = (idx <= 0) ? filteredStreamers.length - 1 : idx - 1;
    } else if (direction === "next") {
        newIdx = (idx >= filteredStreamers.length - 1) ? 0 : idx + 1;
    } else if (direction === "random") {
        newIdx = Math.floor(Math.random() * filteredStreamers.length);
    }

    selectStreamer(filteredStreamers[newIdx].name);
}

// --- Export CSV & JSON & Copy Summary ---
function exportCSV() {
    if (streamersList.length === 0) return;
    var csv = "Rank,Channel,Points,Gain_24h,Gain_Total,Last_Activity_UTC\n";
    streamersList.forEach((s, i) => {
        var dt = s.last_activity ? new Date(s.last_activity).toISOString() : "";
        csv += `${i + 1},${s.name},${s.points || 0},${s.gain_24h || 0},${s.gain_total || 0},"${dt}"\n`;
    });

    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = `twitch_miner_stats_${currentProfile}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function exportJSON() {
    var exportData = currentStreamerRawData || { profile: currentProfile, streamers: streamersList };
    var jsonStr = JSON.stringify(exportData, null, 2);
    var blob = new Blob([jsonStr], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = `${currentStreamer || currentProfile}_analytics.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function copySummaryToClipboard() {
    var totalPts = $("#kpi-total-points-raw").text();
    var gain24h = $("#kpi-24h-sub").text();
    var count = streamersList.length;
    var topCh = $("#kpi-top-streamer").text();

    var text = `📊 **Twitch Miner Analytics Summary** [Profile: ${currentProfile}]\n` +
               `🪙 **Total Points:** ${totalPts}\n` +
               `📈 **24h Farmed:** ${gain24h}\n` +
               `📺 **Channels:** ${count}\n` +
               `🏆 **Top Channel:** ${topCh}\n` +
               `🔗 **Live Dashboard:** https://ranehal.github.io/gitww/`;

    navigator.clipboard.writeText(text).then(() => {
        $("#btn-copy-summary").html('<i class="fas fa-check"></i> Copied!');
        setTimeout(() => {
            $("#btn-copy-summary").html('<i class="fas fa-clipboard"></i> Copy');
        }, 1500);
    });
}

// --- Theme & Accent Color Styling ---
function setAccentColor(color) {
    currentAccentColor = color;
    localStorage.setItem("accentColor", color);
    document.documentElement.style.setProperty("--accent", color);
    document.documentElement.style.setProperty("--border-accent", color);

    $(".accent-dot").removeClass("active");
    $(`.accent-dot[data-color='${color}']`).addClass("active");

    chart.updateOptions({
        colors: [color],
        title: { style: { color: color } }
    });
}

// --- Auto-Refresh Interval Setup ---
function setupAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    var interval = parseInt($("#auto-refresh-select").val()) || 300000;
    if (interval > 0) {
        autoRefreshTimer = setInterval(() => {
            loadDashboardData(false);
            fetchRealtimeTwitchLiveStatus();
        }, interval);
    }
    // Also poll realtime Twitch live status every 45 seconds
    setInterval(fetchRealtimeTwitchLiveStatus, 45000);
}

// --- Cross-Profile Search & Sort Engine ---
function getProfileCounts(results) {
    var counts = {};
    results.forEach(r => {
        counts[r.profile] = (counts[r.profile] || 0) + 1;
    });
    return counts;
}

function preloadCrossStreamersData(onDone) {
    var url = isStaticMode ? "cross_streamers.json" : "/cross_streamers";
    $.getJSON(url, function (data) {
        if (Array.isArray(data) && data.length > 0) {
            crossStreamersDataset = data;
            data.forEach(item => {
                if (!crossProfilesCache[item.profile]) crossProfilesCache[item.profile] = [];
                crossProfilesCache[item.profile].push(item);
            });
            fetchRealtimeTwitchLiveStatus();
        }
        if (onDone) onDone();
    }).fail(function () {
        loadAllProfilesForSearch(onDone);
    });
}

function loadAllProfilesForSearch(onDone) {
    if (crossStreamersDataset && crossStreamersDataset.length > 0) {
        if (onDone) onDone();
        return;
    }
    if (!profilesList || profilesList.length === 0) {
        if (onDone) onDone();
        return;
    }
    var pending = 0;
    profilesList.forEach(p => {
        if (p.id !== "all" && !crossProfilesCache[p.id]) {
            pending++;
            var url = isStaticMode
                ? `analytics/${p.id}/streamers.json`
                : `/streamers?profile=${encodeURIComponent(p.id)}`;
            $.getJSON(url, function (list) {
                if (Array.isArray(list)) {
                    crossProfilesCache[p.id] = list;
                }
            }).always(function () {
                pending--;
                if (pending <= 0 && onDone) onDone();
            });
        }
    });
    if (pending === 0 && onDone) onDone();
}

function showBackToSearchButton(summaryText) {
    if (summaryText) {
        $("#back-search-summary").text(summaryText);
    }
    $("#btn-back-to-search").fadeIn(150);
}

function performCrossProfileSearch() {
    var query = $("#streamer-search").val().trim().toLowerCase();
    if (!query) {
        searchTerm = "";
        $("body").removeClass("is-searching");
        applyFilters();
        $("#search-tab-badge").text("0");
        $("#btn-back-to-search").hide();
        return;
    }

    searchTerm = query;
    $("body").addClass("is-searching");
    applyFilters();

    var results = [];
    var seen = new Set();

    // 1. Preferred source: crossStreamersDataset (contains all streamers across all 35 profiles pre-sorted by points)
    if (crossStreamersDataset && crossStreamersDataset.length > 0) {
        crossStreamersDataset.forEach(s => {
            var matchName = s.name.toLowerCase().includes(query);
            var matchProf = (s.profile || "").toLowerCase().includes(query);
            if (matchName || matchProf) {
                var key = `${s.profile}:${s.name}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    results.push({ ...s });
                }
            }
        });
    } else {
        // 2. Fallback: combine from streamersList & crossProfilesCache
        if (currentProfile !== "all") {
            streamersList.forEach(s => {
                if (s.name.toLowerCase().includes(query) || currentProfile.toLowerCase().includes(query)) {
                    var key = `${currentProfile}:${s.name}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        results.push({ ...s, profile: currentProfile, profileName: currentProfile });
                    }
                }
            });
        }

        Object.keys(crossProfilesCache).forEach(profId => {
            if (profId === "all" || profId === currentProfile) return;
            var pList = crossProfilesCache[profId] || [];
            pList.forEach(s => {
                if (s.name.toLowerCase().includes(query) || profId.toLowerCase().includes(query)) {
                    var key = `${profId}:${s.name}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        results.push({ ...s, profile: profId, profileName: profId });
                    }
                }
            });
        });
    }

    latestGlobalSearchResults = results;
    $("#search-tab-badge").text(results.length);
    renderCrossProfileSearchResults(results, query);

    // Switch to dedicated search tab automatically
    if (!$("#tab-search").hasClass("active")) {
        $(".d-tab").removeClass("active");
        $(".tab-pane").removeClass("active");
        $("#tab-btn-search").addClass("active");
        $("#tab-search").addClass("active");
        $("#drawer-body").slideDown(150);
        $("#btn-toggle-drawer").find("i").removeClass("fa-chevron-up").addClass("fa-chevron-down");
    }

    // If crossStreamersDataset wasn't loaded yet, try fetching it now
    if (!crossStreamersDataset || crossStreamersDataset.length === 0) {
        preloadCrossStreamersData(function () {
            if ($("#streamer-search").val().trim().toLowerCase() === query) {
                performCrossProfileSearch();
            }
        });
    }
}

function renderCrossProfileSearchResults(results, query) {
    var profileCounts = {};
    results.forEach(r => {
        profileCounts[r.profile] = (profileCounts[r.profile] || 0) + 1;
    });

    var $pFilters = $("#search-profile-filters");
    $pFilters.empty();

    var allActiveClass = (crossProfileFilterProfile === "all") ? "active" : "";
    $pFilters.append(`<span class="search-p-chip ${allActiveClass}" data-pfilter="all">All Accounts (${results.length})</span>`);

    Object.keys(profileCounts).forEach(prof => {
        var activeClass = (crossProfileFilterProfile === prof) ? "active" : "";
        var count = profileCounts[prof];
        $pFilters.append(`<span class="search-p-chip ${activeClass}" data-pfilter="${prof}">${prof} (${count})</span>`);
    });

    var filtered = results.slice();
    if (crossProfileFilterProfile !== "all") {
        filtered = filtered.filter(r => r.profile === crossProfileFilterProfile);
    }

    var [sortField, sortDir] = crossProfileSearchSort.split("_");
    var isAsc = (sortDir === "asc");

    // Primary sorting: searching a streamer lists that streamer across all profiles sorted by DESCENDING POINTS!
    filtered.sort((a, b) => {
        // 1. Exact match streamer comes first
        var aExact = (a.name.toLowerCase() === query);
        var bExact = (b.name.toLowerCase() === query);
        if (aExact !== bExact) return aExact ? -1 : 1;

        // 2. Starts with query comes next
        var aStarts = a.name.toLowerCase().startsWith(query);
        var bStarts = b.name.toLowerCase().startsWith(query);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;

        // 3. For the same streamer across different profiles (or default points sort):
        // Sort strictly by DESCENDING POINTS!
        if (sortField === "points" || a.name.toLowerCase() === b.name.toLowerCase()) {
            var ptDiff = (b.points || 0) - (a.points || 0);
            if (ptDiff !== 0) return isAsc ? -ptDiff : ptDiff;
        }

        if (sortField === "gain") {
            var gDiff = (b.gain_24h || 0) - (a.gain_24h || 0);
            if (gDiff !== 0) return isAsc ? -gDiff : gDiff;
        } else if (sortField === "activity") {
            var actDiff = (b.last_activity || 0) - (a.last_activity || 0);
            if (actDiff !== 0) return isAsc ? -actDiff : actDiff;
        } else if (sortField === "name") {
            var nDiff = a.name.localeCompare(b.name);
            if (nDiff !== 0) return isAsc ? nDiff : -nDiff;
        } else if (sortField === "profile") {
            var pDiff = (a.profileName || a.profile).localeCompare(b.profileName || b.profile);
            if (pDiff !== 0) return isAsc ? pDiff : -pDiff;
        }

        // Secondary tie breaker: points desc
        return (b.points || 0) - (a.points || 0);
    });

    var $list = $("#search-results-list");
    $list.empty();

    if (filtered.length === 0) {
        $("#search-query-tag").html(`No accounts found for "${query}"`);
        $("#search-total-count").text("0 found");
        $list.html('<tr><td colspan="10" class="empty-cell" style="padding: 28px; text-align: center;"><i class="fas fa-search" style="font-size: 20px; margin-bottom: 8px; opacity: 0.5;"></i><br>No channels or profiles found matching "' + query + '".</td></tr>');
        return;
    }

    var streamerCounts = {};
    filtered.forEach(item => {
        streamerCounts[item.name] = (streamerCounts[item.name] || 0) + 1;
    });

    var uniqueStreamers = Object.keys(streamerCounts).length;
    var uniqueProfiles = new Set(filtered.map(x => x.profile)).size;

    var subtitle = "";
    if (uniqueStreamers === 1) {
        var sName = filtered[0].name;
        subtitle = `Streamer: <b style="color: #c8aaff;">"${sName}"</b> across <b>${filtered.length} profiles</b> • Sorted by Points (Desc)`;
    } else {
        subtitle = `Found <b>${uniqueStreamers} streamers</b> across <b>${uniqueProfiles} profiles</b> (${filtered.length} total) • Sorted by Points (Desc)`;
    }
    $("#search-query-tag").html(subtitle);
    $("#search-total-count").text(`${filtered.length} found`);

    var streamerCurrentRank = {};

    filtered.forEach(item => {
        enrichStreamer(item);
        var sName = item.name;
        var r = (streamerCurrentRank[sName] || 0) + 1;
        streamerCurrentRank[sName] = r;
        var rankClass = r <= 3 ? `rank-${r}` : "rank-other";

        var gainText = (item.gain_24h && item.gain_24h > 0) ? `+${millify(item.gain_24h)}` : "--";
        var isCurrentProf = (item.profile === currentProfile);
        var profBadge = isCurrentProf
            ? `<span class="search-res-profile-tag active" title="Currently selected miner account in dashboard"><i class="fas fa-user-circle"></i> ${item.profileName || item.profile} (Active)</span>`
            : `<span class="search-res-profile-tag"><i class="fas fa-user-circle"></i> ${item.profileName || item.profile}</span>`;

        var exactPoints = (item.points || 0).toLocaleString();
        var isOnline = isStreamerOnlineRealtime(item.name);
        var liveDetails = getStreamerLiveDetails(item.name);
        var progClass = item.is_target_met ? "met" : (item.is_approaching_target ? "near" : "normal");
        var progLabel = item.target_points > 0 ? `${item.target_pct}%` : "--";
        var rowClass = item.is_approaching_target ? "row-near-target" : "";

        var livePillHtml = isOnline
            ? `<span class="matrix-live-pill online" title="${liveDetails && liveDetails.game ? liveDetails.game : 'Streaming Live on Twitch'}"><span class="live-dot-pulse-mini"></span> LIVE${liveDetails && liveDetails.viewers ? ' (' + millify(liveDetails.viewers) + ')' : ''}</span>`
            : `<span class="matrix-live-pill offline">Offline</span>`;

        var sNameClean = (item.name || "").toLowerCase().trim();
        var sSheet = sheetStreamersMap[sNameClean] || {};
        var sRewardName = item.reward_name || sSheet.reward_name || sSheet.scraped_reward || "";
        var sTargetK = item.target_k || sSheet.target_k || 0;
        var sRewardDesc = item.reward_desc || sSheet.description || "";
        var sRewardHint = sRewardName ? `${item.name} • Reward: ${sRewardName}${sTargetK ? ' (' + sTargetK + 'K target)' : ''}${sRewardDesc ? ' - ' + sRewardDesc : ''}` : item.name;

        var rowHtml = `
            <tr class="search-result-row ${rowClass} ${isCurrentProf ? 'is-current-profile' : ''}" data-channel="${item.name}" data-profile="${item.profile}">
                <td style="text-align: center;">
                    <span class="search-res-rank ${rankClass}" title="Rank #${r} among profiles farming ${item.name}">#${r}</span>
                </td>
                <td>
                    <div class="search-channel-cell">
                        <img class="search-cell-avatar" data-channel="${item.name}" src="banner.png" alt="${item.name}" />
                        <span class="search-cell-name" title="${sRewardHint}">${item.name}</span>
                    </div>
                </td>
                <td>
                    ${livePillHtml}
                </td>
                <td>
                    <span title="${item.reward_desc || ''}" style="font-weight: 700; color: var(--text-bright);">${item.reward_name || '--'}</span>
                </td>
                <td>
                    <div class="matrix-prog-wrap">
                        <div class="matrix-prog-bar">
                            <div class="matrix-prog-fill ${progClass}" style="width: ${Math.min(100, item.target_pct || 0)}%"></div>
                        </div>
                        <div class="matrix-prog-label">
                            <span style="font-weight: 800; color: ${item.is_target_met ? 'var(--gold)' : (item.is_approaching_target ? 'var(--green)' : 'var(--text-sub)')}">${progLabel}</span>
                            <span style="color: var(--text-muted); font-size: 8px;">${item.target_points > 0 ? millify(item.target_points) : ''}</span>
                        </div>
                    </div>
                </td>
                <td>
                    ${profBadge}
                </td>
                <td style="text-align: right;">
                    <div class="pts-table-cell">
                        <span class="pts-exact-num">${exactPoints}</span>
                        <span class="pts-millify-sub">${millify(item.points || 0)} pts</span>
                    </div>
                </td>
                <td style="text-align: right;">
                    <span class="${item.gain_24h > 0 ? 'text-green' : 'text-sub'}" style="font-weight: 700; font-family: var(--font-mono);">${gainText}</span>
                </td>
                <td>
                    <small class="text-sub font-mono">${formatRelativeTime(item.last_activity)}</small>
                </td>
                <td style="text-align: center;">
                    <div class="search-actions-group">
                        <button class="btn-xs btn-spotlight" data-channel="${item.name}" data-profile="${item.profile}" title="Spotlight streamer & open chart in current tab">
                            <i class="fas fa-eye"></i> View
                        </button>
                        <a href="?profile=${encodeURIComponent(item.profile)}&channel=${encodeURIComponent(item.name)}" target="_blank" class="btn-xs btn-newtab" title="Open ${item.name} on ${item.profile} in a new tab without interrupting your work">
                            <i class="fas fa-external-link-alt"></i> New Tab
                        </a>
                        <a href="https://twitch.tv/${item.name}" target="_blank" class="btn-xs btn-twitch-link" title="Open twitch.tv/${item.name}">
                            <i class="fab fa-twitch"></i>
                        </a>
                    </div>
                </td>
            </tr>
        `;
        var $el = $(rowHtml);
        $list.append($el);

        getTwitchAvatar(item.name, function (aUrl) {
            $(`.search-cell-avatar[data-channel="${item.name}"]`).attr("src", aUrl);
        });
    });
}

// --- Farming Timeline Engine (5 Styles) ---
var CHANNEL_PALETTE = [
    "#9146FF", "#00F5A0", "#00E5FF", "#FF385C", "#FFA700",
    "#FF54A2", "#7B2CBF", "#2EC4B6", "#E71D36", "#FF9F1C",
    "#3A86FF", "#8338EC", "#FF006E", "#FB5607", "#FFBE0B",
    "#06D6A0", "#118AB2", "#EF476F", "#F72585", "#7209B7"
];

function getChannelColor(channelName, index = 0) {
    if (!channelName) return CHANNEL_PALETTE[0];
    var hash = 0;
    for (var i = 0; i < channelName.length; i++) {
        hash = channelName.charCodeAt(i) + ((hash << 5) - hash);
    }
    var idx = Math.abs(hash) % CHANNEL_PALETTE.length;
    return CHANNEL_PALETTE[idx];
}

function initFarmingTimeline() {
    var nowMs = Date.now();
    var msScope = (currentTimelineScope === "24h")
        ? (24 * 3600 * 1000)
        : ((currentTimelineScope === "today") ? (nowMs - new Date().setHours(0, 0, 0, 0)) : (7 * 86400000));

    timelineMinTimeGlobal = isFinite(msScope) ? (nowMs - msScope) : (nowMs - 7 * 86400000);
    timelineMaxTimeGlobal = nowMs;

    $("#timeline-summary-tag").html('<i class="fas fa-spinner fa-spin"></i> Loading and computing sessions...');

    var activeChannels = streamersList.filter(s => (s.points || 0) > 0 || (nowMs - (s.last_activity || 0)) <= (7 * 86400000));
    var topCandidates = activeChannels.slice(0, 30);

    if (topCandidates.length === 0) {
        $("#timeline-summary-tag").text("No active farming records in this profile.");
        renderEmptyTimeline();
        return;
    }

    sessionsByChannelGlobal = {};
    var completedCount = 0;
    var hasFinalized = false;

    function checkDone() {
        if (hasFinalized) return;
        completedCount++;
        if (completedCount >= topCandidates.length) {
            hasFinalized = true;
            finalizeTimelineRender(sessionsByChannelGlobal, timelineMinTimeGlobal, timelineMaxTimeGlobal);
        }
    }

    // Safety fallback timeout
    setTimeout(function () {
        if (!hasFinalized) {
            hasFinalized = true;
            finalizeTimelineRender(sessionsByChannelGlobal, timelineMinTimeGlobal, timelineMaxTimeGlobal);
        }
    }, 2500);

    topCandidates.forEach((s, idx) => {
        var sname = s.name;
        if (cachedAllStreamersSeries[sname]) {
            sessionsByChannelGlobal[sname] = clusterSessionsForChannel(sname, cachedAllStreamersSeries[sname], timelineMinTimeGlobal, timelineMaxTimeGlobal, idx);
            checkDone();
        } else {
            var url = (currentProfile === "all")
                ? `data/${sname}.json`
                : `analytics/${currentProfile}/${sname}.json`;
            tryFetch([url, `analytics/${currentProfile}/data/${sname}.json`, `data/${sname}.json`], function (resp) {
                var series = (resp && resp.series) ? resp.series : [];
                cachedAllStreamersSeries[sname] = series;
                sessionsByChannelGlobal[sname] = clusterSessionsForChannel(sname, series, timelineMinTimeGlobal, timelineMaxTimeGlobal, idx);
                checkDone();
            }, function () {
                sessionsByChannelGlobal[sname] = [];
                checkDone();
            });
        }
    });
}

function clusterSessionsForChannel(channelName, rawSeries, minTime, maxTime, colorIndex) {
    if (!rawSeries || rawSeries.length === 0) return [];
    var filtered = rawSeries.filter(pt => pt.x >= minTime && pt.x <= maxTime);
    if (filtered.length === 0) return [];

    filtered.sort((a, b) => a.x - b.x);

    var sessions = [];
    var currentSession = null;
    var color = getChannelColor(channelName, colorIndex);

    for (var i = 0; i < filtered.length; i++) {
        var pt = filtered[i];
        if (!currentSession) {
            currentSession = {
                channel: channelName,
                startTime: pt.x,
                endTime: pt.x + (15 * 60 * 1000),
                startPoints: pt.y,
                endPoints: pt.y,
                eventCount: 1,
                color: color
            };
        } else {
            var gap = pt.x - currentSession.endTime;
            if (gap <= (35 * 60 * 1000)) {
                currentSession.endTime = Math.max(currentSession.endTime, pt.x);
                currentSession.endPoints = pt.y;
                currentSession.eventCount++;
            } else {
                currentSession.pointsGained = Math.max(0, currentSession.endPoints - currentSession.startPoints);
                currentSession.durationMinutes = Math.round((currentSession.endTime - currentSession.startTime) / 60000);
                sessions.push(currentSession);

                currentSession = {
                    channel: channelName,
                    startTime: pt.x,
                    endTime: pt.x + (15 * 60 * 1000),
                    startPoints: pt.y,
                    endPoints: pt.y,
                    eventCount: 1,
                    color: color
                };
            }
        }
    }

    if (currentSession) {
        currentSession.pointsGained = Math.max(0, currentSession.endPoints - currentSession.startPoints);
        currentSession.durationMinutes = Math.round((currentSession.endTime - currentSession.startTime) / 60000);
        sessions.push(currentSession);
    }

    return sessions;
}

function finalizeTimelineRender(sessionsByChannel, minTime, maxTime) {
    var allSessions = [];
    var activeChannelCount = 0;
    Object.keys(sessionsByChannel).forEach(ch => {
        var sList = sessionsByChannel[ch];
        if (sList && sList.length > 0) {
            activeChannelCount++;
            allSessions = allSessions.concat(sList);
        }
    });

    computedTimelineSessions = allSessions;
    var totalMinutes = allSessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
    var totalHours = (totalMinutes / 60).toFixed(1);

    $("#timeline-summary-tag").html(`<b>${activeChannelCount}</b> active channels • <b>${allSessions.length}</b> farming sessions • ~<b>${totalHours} hrs</b> farmed`);

    if (allSessions.length > 0 && currentTimelineScope === "all") {
        var earliest = allSessions.reduce((m, s) => Math.min(m, s.startTime), Infinity);
        if (isFinite(earliest)) {
            minTime = earliest - (15 * 60 * 1000);
        }
    }

    renderCurrentTimelineStyle(sessionsByChannel, allSessions, minTime, maxTime);
}

function renderCurrentTimelineStyle(sessionsByChannel, allSessions, minTime, maxTime) {
    if (!allSessions || allSessions.length === 0) {
        renderEmptyTimeline();
        return;
    }

    $(".timeline-view-pane").removeClass("active");
    $(`#timeline-style-${currentTimelineStyle}`).addClass("active");

    if (currentTimelineStyle === 1) {
        renderStyle1SwimlaneGantt(sessionsByChannel, minTime, maxTime);
    } else if (currentTimelineStyle === 2) {
        renderStyle2Heatmap(sessionsByChannel, minTime, maxTime);
    } else if (currentTimelineStyle === 3) {
        renderStyle3RangeBarChart(sessionsByChannel, allSessions);
    } else if (currentTimelineStyle === 4) {
        renderStyle4WaterfallStream(allSessions);
    } else if (currentTimelineStyle === 5) {
        renderStyle5RibbonStrip(sessionsByChannel, minTime, maxTime);
    }
}

function renderEmptyTimeline() {
    var $pane = $(`#timeline-style-${currentTimelineStyle}`);
    $pane.html('<div class="timeline-empty-msg" style="padding: 40px; text-align: center; color: var(--text-muted);"><i class="fas fa-bed fa-2x" style="margin-bottom: 8px;"></i><br>No farming events recorded in this timeframe.</div>');
}

// STYLE 1: Swimlane Gantt Matrix
function renderStyle1SwimlaneGantt(sessionsByChannel, minTime, maxTime) {
    var $pane = $("#timeline-style-1");
    if (!$("#gantt-container").length) {
        $pane.html('<div class="gantt-container" id="gantt-container"></div>');
    }
    var $box = $("#gantt-container");
    $box.empty();

    var totalDuration = Math.max(1, maxTime - minTime);

    var t0 = new Date(minTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var t25 = new Date(minTime + totalDuration * 0.25).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var t50 = new Date(minTime + totalDuration * 0.50).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var t75 = new Date(minTime + totalDuration * 0.75).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var t100 = new Date(maxTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    var rulerHtml = `
        <div class="gantt-header">
            <span class="gantt-channel-col-head"><i class="fas fa-tv"></i> CHANNEL</span>
            <div class="gantt-ticks-wrap">
                <span>${t0}</span>
                <span>${t25}</span>
                <span>${t50}</span>
                <span>${t75}</span>
                <span>${t100}</span>
            </div>
        </div>
    `;
    $box.append(rulerHtml);

    var channels = Object.keys(sessionsByChannel).filter(ch => sessionsByChannel[ch].length > 0);
    channels.sort((a, b) => sessionsByChannel[b].length - sessionsByChannel[a].length);

    channels.forEach(ch => {
        var sList = sessionsByChannel[ch];
        var blocksHtml = "";

        sList.forEach(s => {
            var leftPct = Math.max(0, Math.min(100, ((s.startTime - minTime) / totalDuration) * 100));
            var widthPct = Math.max(1.5, Math.min(100 - leftPct, ((s.endTime - s.startTime) / totalDuration) * 100));
            var startTimeStr = new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            var endTimeStr = new Date(s.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            var tip = `${ch}: ${startTimeStr} - ${endTimeStr} (${s.durationMinutes}m) | +${s.pointsGained} pts (${s.eventCount} evts)`;

            blocksHtml += `
                <div class="gantt-block" style="left: ${leftPct}%; width: ${widthPct}%; background: ${s.color};" title="${tip}" onClick="selectStreamer('${ch}')"></div>
            `;
        });

        var rowHtml = `
            <div class="gantt-row">
                <div class="gantt-channel-info" onClick="selectStreamer('${ch}')">
                    <span class="status-dot active"></span>
                    <span class="gantt-channel-name">${ch}</span>
                </div>
                <div class="gantt-track">${blocksHtml}</div>
            </div>
        `;
        $box.append(rowHtml);
    });
}

// STYLE 2: 24h Activity Heatmap Grid
function renderStyle2Heatmap(sessionsByChannel, minTime, maxTime) {
    var $pane = $("#timeline-style-2");
    if (!$("#heatmap-container").length) {
        $pane.html('<div class="heatmap-container" id="heatmap-container"></div>');
    }
    var $box = $("#heatmap-container");
    $box.empty();

    var hourCols = "";
    for (var h = 0; h < 24; h++) {
        var hrStr = (h < 10 ? "0" : "") + h + "h";
        hourCols += `<div class="heatmap-hour-label">${hrStr}</div>`;
    }

    var headerHtml = `
        <div class="heatmap-grid-header">
            <span class="heatmap-channel-label" style="font-weight: 800; color: var(--text-muted);">CHANNEL (24H GRID)</span>
            ${hourCols}
        </div>
    `;
    $box.append(headerHtml);

    var channels = Object.keys(sessionsByChannel).filter(ch => sessionsByChannel[ch].length > 0);

    channels.forEach(ch => {
        var sList = sessionsByChannel[ch];
        var hourCounts = new Array(24).fill(0);
        var hourPoints = new Array(24).fill(0);

        sList.forEach(s => {
            var h = new Date(s.startTime).getHours();
            hourCounts[h] += s.eventCount;
            hourPoints[h] += (s.pointsGained || 0);
        });

        var cellsHtml = "";
        for (var h = 0; h < 24; h++) {
            var cnt = hourCounts[h];
            var pts = hourPoints[h];
            var lvl = cnt === 0 ? "level-0" : (cnt <= 2 ? "level-1" : (cnt <= 5 ? "level-2" : (cnt <= 10 ? "level-3" : "level-4")));
            var tip = `${ch} at ${h}:00 - ${cnt} events (+${pts} pts)`;
            cellsHtml += `<div class="heatmap-cell ${lvl}" title="${tip}" onClick="selectStreamer('${ch}')">${cnt > 0 ? cnt : ""}</div>`;
        }

        var rowHtml = `
            <div class="heatmap-row">
                <span class="heatmap-channel-label" title="${ch}" onClick="selectStreamer('${ch}')">${ch}</span>
                ${cellsHtml}
            </div>
        `;
        $box.append(rowHtml);
    });
}

// STYLE 3: RangeBar Interactive ApexChart
function renderStyle3RangeBarChart(sessionsByChannel, allSessions) {
    var $pane = $("#timeline-style-3");
    if (!$("#timeline-rangebar-chart").length) {
        $pane.html('<div id="timeline-rangebar-chart" style="min-height: 380px;"></div>');
    }
    var $chartDiv = $("#timeline-rangebar-chart");
    $chartDiv.empty();

    var chartData = [];
    var channels = Object.keys(sessionsByChannel).filter(ch => sessionsByChannel[ch].length > 0);
    channels.sort((a, b) => sessionsByChannel[b].length - sessionsByChannel[a].length);

    channels.forEach(ch => {
        var sList = sessionsByChannel[ch];
        sList.forEach(s => {
            chartData.push({
                x: ch,
                y: [s.startTime, s.endTime],
                fillColor: s.color
            });
        });
    });

    var options = {
        series: [{ data: chartData }],
        chart: {
            type: "rangeBar",
            height: Math.max(340, channels.length * 28),
            toolbar: { show: true, tools: { zoom: true, pan: true, reset: true } },
            background: "transparent",
            foreColor: "#adadb8",
            events: {
                dataPointSelection: function (event, chartContext, config) {
                    var item = chartData[config.dataPointIndex];
                    if (item && item.x) selectStreamer(item.x);
                }
            }
        },
        plotOptions: {
            bar: {
                horizontal: true,
                distributed: true,
                rangeBarGroupRows: true,
                barHeight: "65%"
            }
        },
        xaxis: {
            type: "datetime",
            labels: { datetimeUTC: false }
        },
        tooltip: {
            theme: "dark",
            custom: function ({ series, seriesIndex, dataPointIndex, w }) {
                var item = chartData[dataPointIndex];
                if (!item) return "";
                var d1 = new Date(item.y[0]).toLocaleTimeString();
                var d2 = new Date(item.y[1]).toLocaleTimeString();
                return `<div style="padding: 8px 12px; background: #14141b; border: 1px solid ${item.fillColor}; border-radius: 4px; font-size: 11px;">
                    <div style="font-weight: 800; color: #fff;">${item.x}</div>
                    <div style="color: var(--text-sub);">Farming: ${d1} - ${d2}</div>
                </div>`;
            }
        }
    };

    if (timelineApexChartInstance) {
        try { timelineApexChartInstance.destroy(); } catch (e) {}
    }
    timelineApexChartInstance = new ApexCharts(document.querySelector("#timeline-rangebar-chart"), options);
    timelineApexChartInstance.render();
}

// STYLE 4: Waterfall Event Stream
function renderStyle4WaterfallStream(allSessions) {
    var $pane = $("#timeline-style-4");
    if (!$("#waterfall-stream-container").length) {
        $pane.html('<div class="waterfall-stream-container" id="waterfall-stream-container"></div>');
    }
    var $box = $("#waterfall-stream-container");
    $box.empty();

    var sorted = allSessions.slice().sort((a, b) => b.startTime - a.startTime).slice(0, 40);

    sorted.forEach(s => {
        var d1 = new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        var d2 = new Date(s.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        var dateStr = new Date(s.startTime).toLocaleDateString([], { month: 'short', day: 'numeric' });

        var cardHtml = `
            <div class="waterfall-card" style="border-left-color: ${s.color};" onClick="selectStreamer('${s.channel}')">
                <span class="wf-time-range">${dateStr} ${d1} → ${d2}</span>
                <span class="wf-channel"><span class="status-dot active"></span> ${s.channel}</span>
                <span class="wf-duration">⏱️ ${s.durationMinutes} min</span>
                <span class="wf-pts">+${formatNumber(s.pointsGained || (s.eventCount * 10))} pts (${s.eventCount} evts)</span>
            </div>
        `;
        $box.append(cardHtml);
    });
}

// STYLE 5: Ultra-Dense Ribbon Strip
function renderStyle5RibbonStrip(sessionsByChannel, minTime, maxTime) {
    var $pane = $("#timeline-style-5");
    if (!$("#ribbon-strip-container").length) {
        $pane.html('<div class="ribbon-strip-container" id="ribbon-strip-container"></div>');
    }
    var $box = $("#ribbon-strip-container");
    $box.empty();

    var totalDuration = Math.max(1, maxTime - minTime);
    var channels = Object.keys(sessionsByChannel).filter(ch => sessionsByChannel[ch].length > 0);

    channels.forEach(ch => {
        var sList = sessionsByChannel[ch];
        var segsHtml = "";

        sList.forEach(s => {
            var leftPct = Math.max(0, Math.min(100, ((s.startTime - minTime) / totalDuration) * 100));
            var widthPct = Math.max(0.8, Math.min(100 - leftPct, ((s.endTime - s.startTime) / totalDuration) * 100));
            segsHtml += `<div class="ribbon-segment" style="left: ${leftPct}%; width: ${widthPct}%; background: ${s.color};" title="${ch}: ${s.durationMinutes}m active"></div>`;
        });

        var rowHtml = `
            <div class="ribbon-row" onClick="selectStreamer('${ch}')" style="cursor: pointer;">
                <span class="ribbon-name" title="${ch}">${ch}</span>
                <div class="ribbon-track">${segsHtml}</div>
            </div>
        `;
        $box.append(rowHtml);
    });
}

// --- All Event Listeners Wire-up ---
function setupEventListeners() {
    // Profile Switcher Dropdown Toggle
    $("#profile-switcher-btn").click(function (e) {
        e.stopPropagation();
        $("#profile-switcher-container").toggleClass("open");
    });

    $(document).click(function () {
        $("#profile-switcher-container").removeClass("open");
    });

    $("#profile-dropdown-menu").click(function (e) {
        e.stopPropagation();
    });

    // Profile Search
    $("#profile-search-input").on("input", function () {
        var term = $(this).val().toLowerCase();
        $(".profile-item").each(function () {
            var name = $(this).find(".p-name").text().toLowerCase();
            $(this).toggle(name.includes(term));
        });
    });

    // Refresh button
    $("#btn-refresh").click(function () {
        $("#refresh-icon").addClass("fa-spin");
        loadDashboardData(true, function () {
            setTimeout(() => { $("#refresh-icon").removeClass("fa-spin"); }, 500);
        });
    });

    // Auto-refresh interval change
    $("#auto-refresh-select").change(setupAutoRefresh);

    // Cross-Profile Channel Search
    $("#streamer-search").on("input", function () {
        var val = $(this).val().trim();
        $("#search-clear").toggle(val.length > 0);
        performCrossProfileSearch();
    });

    $("#search-clear").click(function () {
        $("#streamer-search").val("");
        searchTerm = "";
        $("body").removeClass("is-searching");
        $(this).hide();
        $("#btn-back-to-search").hide();
        $("#search-tab-badge").text("0");
        latestGlobalSearchResults = [];
        $("#search-results-list").html('<tr><td colspan="8" class="empty-cell">Type a streamer name in the top searchbar to see points across all 35 profiles.</td></tr>');
        $("#search-profile-filters").empty();
        applyFilters();
    });

    // Back to Search Button in Toolbar (Preserves progress & returns to search tab)
    $("#btn-back-to-search").click(function () {
        $("body").addClass("is-searching");
        $(".d-tab").removeClass("active");
        $(".tab-pane").removeClass("active");
        $("#tab-btn-search").addClass("active");
        $("#tab-search").addClass("active");
        $("#drawer-body").slideDown(150);
        $("#btn-toggle-drawer").find("i").removeClass("fa-chevron-up").addClass("fa-chevron-down");
        var drawer = document.getElementById("bottom-drawer-card");
        if (drawer) {
            drawer.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    });

    // Clear Search Button inside Dedicated Search Tab
    $("#btn-clear-search-tab").click(function () {
        $("#streamer-search").val("");
        searchTerm = "";
        $("body").removeClass("is-searching");
        $("#search-clear").hide();
        $("#btn-back-to-search").hide();
        $("#search-tab-badge").text("0");
        latestGlobalSearchResults = [];
        $("#search-results-list").html('<tr><td colspan="8" class="empty-cell">Type a streamer name in the top searchbar to see points across all 35 profiles.</td></tr>');
        $("#search-profile-filters").empty();
        $("#search-total-count").text("0 found");
        applyFilters();

        // Switch to Live Activity Feed
        $(".d-tab").removeClass("active");
        $(".tab-pane").removeClass("active");
        $(".d-tab[data-tab='tab-events']").addClass("active");
        $("#tab-events").addClass("active");
    });

    // Search Results Sort
    $("#search-results-sort").change(function () {
        crossProfileSearchSort = $(this).val();
        renderCrossProfileSearchResults(latestGlobalSearchResults, $("#streamer-search").val().trim().toLowerCase());
    });

    $("#btn-search-sort-dir").click(function () {
        if (crossProfileSearchSort.endsWith("_desc")) {
            crossProfileSearchSort = crossProfileSearchSort.replace("_desc", "_asc");
        } else if (crossProfileSearchSort.endsWith("_asc")) {
            crossProfileSearchSort = crossProfileSearchSort.replace("_asc", "_desc");
        }
        $("#search-results-sort").val(crossProfileSearchSort);
        renderCrossProfileSearchResults(latestGlobalSearchResults, $("#streamer-search").val().trim().toLowerCase());
    });

    // Profile Filter Chips inside Search Tab
    $(document).on("click", ".search-p-chip", function () {
        crossProfileFilterProfile = $(this).data("pfilter");
        renderCrossProfileSearchResults(latestGlobalSearchResults, $("#streamer-search").val().trim().toLowerCase());
    });

    // Spotlight View button handler in search table
    $(document).on("click", ".btn-spotlight", function (e) {
        e.stopPropagation();
        var ch = $(this).data("channel");
        var prof = $(this).data("profile");

        var curQuery = $("#streamer-search").val().trim();
        showBackToSearchButton(curQuery || ch);

        if (prof && prof !== currentProfile) {
            switchProfile(prof);
            setTimeout(() => { selectStreamer(ch); }, 300);
        } else {
            selectStreamer(ch);
        }

        var spotlightCard = document.getElementById("spotlight-card");
        if (spotlightCard) {
            spotlightCard.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    });

    // Spotlight Breakdown Counters (Click to Filter Events Feed & Chart)
    $(".spotlight-breakdown-counters .b-box").click(function () {
        var etype = $(this).data("etype");
        if ($(this).hasClass("active")) {
            $(this).removeClass("active");
            activeEventFilter = "all";
            $(".e-chip").removeClass("active");
            $(".e-chip[data-etype='all']").addClass("active");
        } else {
            $(".spotlight-breakdown-counters .b-box").removeClass("active");
            $(this).addClass("active");
            activeEventFilter = etype;
            $(".e-chip").removeClass("active");
            $(`.e-chip[data-etype='${etype}']`).addClass("active");
        }

        if (currentStreamerRawData && currentStreamer) {
            renderEventsFeed(currentStreamer, currentStreamerRawData);
        }
        updateAnnotations();
    });

    // Header Live Pill Click (Toggle Online Filter)
    $("#header-live-pill").click(function () {
        if (activeFilter === "online") {
            activeFilter = "all";
            $(".filter-tab").removeClass("active");
            $('.filter-tab[data-filter="all"]').addClass("active");
            $("#header-live-pill").removeClass("active-filter");
        } else {
            activeFilter = "online";
            $(".filter-tab").removeClass("active");
            $('.filter-tab[data-filter="online"]').addClass("active");
            $("#header-live-pill").addClass("active-filter");
        }
        applyFilters();
    });

    // Filter Tabs
    $(".filter-tab").click(function () {
        $(".filter-tab").removeClass("active");
        $(this).addClass("active");
        activeFilter = $(this).data("filter");
        if (activeFilter === "online") {
            $("#header-live-pill").addClass("active-filter");
        } else {
            $("#header-live-pill").removeClass("active-filter");
        }
        applyFilters();
    });

    // Tier Chips
    $(".tier-chip").click(function () {
        $(".tier-chip").removeClass("active");
        $(this).addClass("active");
        activeTier = $(this).data("tier");
        applyFilters();
    });

    // Sort Dropdown
    $("#sort-select").change(function () {
        currentSort = $(this).val();
        applySort();
        applyFilters();
    });

    // Reverse Sort Direction Button
    $("#btn-toggle-sort-dir").click(function () {
        if (currentSort.endsWith("_desc")) {
            currentSort = currentSort.replace("_desc", "_asc");
        } else {
            currentSort = currentSort.replace("_asc", "_desc");
        }
        $("#sort-select").val(currentSort);
        applySort();
        applyFilters();
    });

    // Column header sort in sidebar
    $("#th-name").click(() => { currentSort = currentSort === "name_asc" ? "name_desc" : "name_asc"; $("#sort-select").val(currentSort); applySort(); applyFilters(); });
    $("#th-target").click(() => { currentSort = (currentSort === "proximity_desc" ? "proximity_asc" : "proximity_desc"); $("#sort-select").val(currentSort); applySort(); applyFilters(); });
    $("#th-gain").click(() => { currentSort = currentSort === "gain_desc" ? "gain_asc" : "gain_desc"; $("#sort-select").val(currentSort); applySort(); applyFilters(); });
    $("#th-pts").click(() => { currentSort = currentSort === "points_desc" ? "points_asc" : "points_desc"; $("#sort-select").val(currentSort); applySort(); applyFilters(); });

    // Timeframe Presets
    $(".btn-tf").click(function () {
        $(".btn-tf").removeClass("active");
        $(this).addClass("active");
        var preset = $(this).data("preset");
        var now = new Date();

        if (preset === "1h") startDate = new Date(Date.now() - 3600000);
        else if (preset === "6h") startDate = new Date(Date.now() - 6 * 3600000);
        else if (preset === "12h") startDate = new Date(Date.now() - 12 * 3600000);
        else if (preset === "24h") startDate = new Date(Date.now() - 86400000);
        else if (preset === "today") startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        else if (preset === "3d") startDate = new Date(Date.now() - 3 * 86400000);
        else if (preset === "7d") startDate = new Date(Date.now() - 7 * 86400000);
        else if (preset === "14d") startDate = new Date(Date.now() - 14 * 86400000);
        else if (preset === "30d") startDate = new Date(Date.now() - 30 * 86400000);
        else if (preset === "90d") startDate = new Date(Date.now() - 90 * 86400000);
        else if (preset === "inf") startDate = new Date(0);

        endDate = new Date();
        if (preset === "inf") $("#startDate").val("");
        else $("#startDate").val(formatDate(startDate));
        $("#endDate").val(formatDate(endDate));

        renderChartData();
    });

    // Custom Date Inputs
    $("#startDate").change(function () {
        startDate = $(this).val() ? new Date($(this).val()) : new Date(0);
        $(".btn-tf").removeClass("active");
        renderChartData();
    });
    $("#endDate").change(function () {
        endDate = $(this).val() ? new Date($(this).val()) : new Date();
        $(".btn-tf").removeClass("active");
        renderChartData();
    });
    $("#btn-clear-date").click(function () {
        startDate = new Date(0);
        endDate = new Date();
        $("#startDate").val("");
        $("#endDate").val(formatDate(endDate));
        $(".btn-tf").removeClass("active");
        $(".btn-tf[data-preset='inf']").addClass("active");
        renderChartData();
    });

    // Chart Style Buttons
    $("#btn-chart-type").click(function () {
        chartType = (chartType === "area") ? "line" : "area";
        $(this).text(chartType === "area" ? "Area" : "Line");
        renderChartData();
    });

    $("#btn-chart-curve").click(function () {
        if (chartCurve === "smooth") chartCurve = "straight";
        else if (chartCurve === "straight") chartCurve = "stepline";
        else chartCurve = "smooth";
        $(this).text(chartCurve.charAt(0).toUpperCase() + chartCurve.slice(1));
        renderChartData();
    });

    $("#btn-toggle-annotations").click(function () {
        showAnnotations = !showAnnotations;
        $(this).toggleClass("active", showAnnotations);
        updateAnnotations();
    });

    $("#btn-reset-zoom").click(function () {
        chart.resetSeries();
    });

    $("#btn-fullscreen-chart").click(function () {
        $("#chart-canvas-card").toggleClass("fullscreen");
        var isFs = $("#chart-canvas-card").hasClass("fullscreen");
        $(this).html(isFs ? '<i class="fas fa-compress"></i> Exit' : '<i class="fas fa-expand"></i> Fullscreen');
        setTimeout(() => { chart.windowResize(); }, 200);
    });

    // Navigation buttons
    $("#btn-prev-streamer").click(() => navigateStreamer("prev"));
    $("#btn-next-streamer").click(() => navigateStreamer("next"));
    $("#btn-random-streamer").click(() => navigateStreamer("random"));

    // Export buttons
    $("#btn-export-csv").click(exportCSV);
    $("#btn-export-json").click(exportJSON);
    $("#btn-copy-summary").click(copySummaryToClipboard);

    // Layout View Mode Toggles
    $("#view-mode-default").click(function () {
        $(".view-toggles button").removeClass("active");
        $(this).addClass("active");
        $("body").removeClass("view-wide-mode view-table-mode");
    });
    $("#view-mode-wide").click(function () {
        $(".view-toggles button").removeClass("active");
        $(this).addClass("active");
        $("body").addClass("view-wide-mode").removeClass("view-table-mode");
    });
    $("#view-mode-table").click(function () {
        $(".view-toggles button").removeClass("active");
        $(this).addClass("active");
        $("body").addClass("view-table-mode").removeClass("view-wide-mode");
    });

    // Theme & Accent controls
    $("#btn-toggle-theme").click(function () {
        $("body").toggleClass("oled-theme");
        localStorage.setItem("oledTheme", $("body").hasClass("oled-theme"));
    });

    $(".accent-dot").click(function () {
        var color = $(this).data("color");
        setAccentColor(color);
    });

    // Drawer Tabs
    $(".d-tab").click(function () {
        $(".d-tab").removeClass("active");
        $(".tab-pane").removeClass("active");
        $(this).addClass("active");
        var target = $(this).data("tab");
        $(`#${target}`).addClass("active");

        if (target === "tab-timeline") {
            initFarmingTimeline();
        }
    });

    // Timeline Style Switcher (Styles 1, 2, 3, 4, 5)
    $(".t-style-btn").click(function () {
        $(".t-style-btn").removeClass("active");
        $(this).addClass("active");
        currentTimelineStyle = parseInt($(this).data("style"), 10);
        renderCurrentTimelineStyle(sessionsByChannelGlobal, computedTimelineSessions, timelineMinTimeGlobal, timelineMaxTimeGlobal);
    });

    // Timeline Scope Buttons (24h, Today, All-Time)
    $(".btn-xs-scope").click(function () {
        $(".btn-xs-scope").removeClass("active");
        $(this).addClass("active");
        currentTimelineScope = $(this).data("tscope");
        initFarmingTimeline();
    });

    $("#btn-toggle-drawer").click(function () {
        $("#drawer-body").slideToggle(150);
        $(this).find("i").toggleClass("fa-chevron-down fa-chevron-up");
    });

    // Event filter chips in drawer
    $(".e-chip").click(function () {
        $(".e-chip").removeClass("active");
        $(this).addClass("active");
        activeEventFilter = $(this).data("etype");
        if (currentStreamerRawData) {
            renderEventsFeed(currentStreamer, currentStreamerRawData);
        }
    });

    // Miner Log Controls
    $("#btn-pause-log").click(function () {
        autoUpdateLog = !autoUpdateLog;
        $(this).text(autoUpdateLog ? "⏸️ Pause" : "▶️ Resume");
        if (autoUpdateLog) getLog();
    });
    $("#btn-clear-log").click(function () {
        $("#log-content").text("");
    });
}

// --- Miner Terminal Log Streaming (Flask mode) ---
var autoUpdateLog = true;
var lastReceivedLogIndex = 0;

function getLog() {
    if (!isStaticMode && $("#tab-log").hasClass("active")) {
        $.get(`/log?lastIndex=${lastReceivedLogIndex}`, function (data) {
            if (data) {
                $("#log-content").append(data);
                $("#log-content").scrollTop($("#log-content")[0].scrollHeight);
                lastReceivedLogIndex += data.length;
            }
            if (autoUpdateLog) {
                setTimeout(getLog, 2500);
            }
        });
    }
}
