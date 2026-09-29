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

// Timeframe State
var daysAgoSetting = typeof flaskDaysAgo !== "undefined" ? flaskDaysAgo : "inf";
var isAllTime = (daysAgoSetting === "inf" || daysAgoSetting === "infinity" || isNaN(parseInt(daysAgoSetting)));
var startDate = isAllTime ? new Date(0) : new Date(Date.now() - (parseInt(daysAgoSetting) * 86400000));
var endDate = new Date();

// Chart Config
var chartType = "area"; // area or line
var chartCurve = "smooth"; // smooth, straight, stepline
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
    stroke: { curve: "smooth", width: 2.5 },
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

    $.getJSON(profUrl, function (data) {
        if (Array.isArray(data) && data.length > 0) {
            profilesList = data;
            renderProfilesDropdown();

            // Set current profile
            var found = profilesList.find(p => p.id === currentProfile);
            if (!found) {
                currentProfile = "all";
            }
            updateProfileButton(currentProfile);
        }
        // Load initial dashboard data for active profile
        loadDashboardData(true);
    }).fail(function () {
        // Fallback profile if profiles.json missing
        profilesList = [{ id: "all", name: "All Accounts (Combined)", total_points: 0 }];
        updateProfileButton("all");
        loadDashboardData(true);
    });
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
        var isOnline = s.active_today || (now_ms - (s.last_activity || 0)) <= ms_24h;
        var dotClass = isOnline ? "active" : "";
        var gainText = (s.gain_24h && s.gain_24h > 0) ? `+${millify(s.gain_24h)}` : "--";

        var li = `
            <li class="channel-li ${activeClass}" id="ch-item-${s.name}" onClick="selectStreamer('${s.name}')">
                <span class="li-rank">${idx + 1}</span>
                <div class="li-name-wrap">
                    <span class="status-dot ${dotClass}" title="${isOnline ? 'Active today' : 'Offline'}"></span>
                    <span class="li-name">${s.name}</span>
                </div>
                <span class="li-gain">${gainText}</span>
                <span class="li-pts">${millify(s.points || 0)}</span>
            </li>
        `;
        $ul.append(li);
    });

    if (currentStreamer) {
        var el = document.getElementById(`ch-item-${currentStreamer}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
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

    $("#spotlight-name").text(name);
    $("#spotlight-url").attr("href", `https://twitch.tv/${name}`);
    $("#btn-external-twitch").attr("href", `https://twitch.tv/${name}`);

    $("#spotlight-points").html(`<i class="fas fa-coins"></i> ${formatNumber(currentPts)} pts`);
    $("#spotlight-gain-24h").html(`<i class="fas fa-arrow-up"></i> +${formatNumber(meta.gain_24h || 0)} 24h`);
    $("#spotlight-gain-total").html(`<i class="fas fa-history"></i> +${formatNumber(totalGain)} all-time`);
    $("#spotlight-last-active").html(`<i class="far fa-clock"></i> ${formatRelativeTime(lastActive)}`);
    $("#spotlight-events-count").html(`<i class="fas fa-receipt"></i> ${formatNumber(series.length)} events`);

    // Live tag
    var isLiveNow = (Date.now() - lastActive) <= (24 * 3600 * 1000);
    $("#spotlight-live-tag").toggle(isLiveNow);

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
}

function renderChartData() {
    if (!currentStreamerRawData || !currentStreamer) return;

    var startMs = (startDate && !isNaN(startDate.getTime())) ? startDate.getTime() : 0;
    var endMs = (endDate && !isNaN(endDate.getTime())) ? new Date(endDate).setHours(23, 59, 59, 999) : Infinity;

    var rawSeries = currentStreamerRawData.series || [];
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
    var series = data.series || [];

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
        var bd = s.breakdown || {};
        var lastAct = s.last_activity ? formatRelativeTime(s.last_activity) : "--";

        rows += `
            <tr>
                <td><b>#${idx + 1}</b></td>
                <td><b>${s.name}</b></td>
                <td><span class="metric-pill pill-purple">${formatNumber(s.points || 0)}</span></td>
                <td><span class="text-green">+${formatNumber(s.gain_24h || 0)}</span></td>
                <td><span class="text-blue">+${formatNumber(s.gain_total || 0)}</span></td>
                <td><small>${lastAct}</small></td>
                <td>${bd.Watch || 0}</td>
                <td>${bd.Claim || 0}</td>
                <td>${bd.Streak || 0}</td>
                <td>${bd.Raid || 0}</td>
                <td>
                    <button class="btn-xs btn-twitch" onClick="selectStreamer('${s.name}')">View Chart</button>
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
        }, interval);
    }
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

    // Channel Search
    $("#streamer-search").on("input", function () {
        searchTerm = $(this).val().trim().toLowerCase();
        $("#search-clear").toggle(searchTerm.length > 0);
        applyFilters();
    });

    $("#search-clear").click(function () {
        $("#streamer-search").val("");
        searchTerm = "";
        $(this).hide();
        applyFilters();
    });

    // Filter Tabs
    $(".filter-tab").click(function () {
        $(".filter-tab").removeClass("active");
        $(this).addClass("active");
        activeFilter = $(this).data("filter");
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
