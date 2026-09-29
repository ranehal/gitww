// ==========================================
// Twitch Miner Live Analytics Dashboard JS
// Supports Flask Server AND Static GitHub Pages
// ==========================================

// Helper: Format numbers to human-readable (e.g. 1.25M, 45.2K)
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

// Chart Options
var options = {
    series: [],
    chart: {
        type: "area",
        stacked: false,
        height: 480,
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
        animations: {
            enabled: true,
            easing: "easeinout",
            speed: 600
        }
    },
    dataLabels: { enabled: false },
    stroke: { curve: "smooth", width: 2.5 },
    markers: { size: 0, hover: { size: 5 } },
    colors: ["#9146FF"],
    fill: {
        type: "gradient",
        gradient: {
            shadeIntensity: 1,
            inverseColors: false,
            opacityFrom: 0.55,
            opacityTo: 0.05,
            stops: [0, 90, 100]
        }
    },
    yaxis: {
        title: { text: "Channel Points", style: { color: "#adadb8" } },
        labels: {
            formatter: function (val) {
                return millify(val);
            }
        }
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
            return `<div class="apexcharts-tooltip-custom" style="padding: 10px; background: #18181b; border: 1px solid #9146FF; border-radius: 6px;">
                <div style="font-weight: 700; color: #bf94ff; margin-bottom: 4px;">${name}</div>
                <div style="font-size: 13px; color: #fff;"><b>Points:</b> ${formatNumber(val)}</div>
                ${zVal ? `<div style="font-size: 12px; color: #00f59b; margin-top: 2px;"><b>Event:</b> ${zVal}</div>` : ""}
            </div>`;
        }
    },
    noData: { text: "Loading streamer points...", style: { color: "#bf94ff", fontSize: "14px" } }
};

var chart = new ApexCharts(document.querySelector("#chart"), options);
var currentStreamer = null;
var annotations = [];
var streamersList = [];
var filteredStreamers = [];
var activeFilter = "all";
var searchTerm = "";
var sortBy = "Points descending";
var sortField = "points";

// Environment detection: Check if running statically or on Flask
var isStaticMode = (
    window.location.hostname.endsWith("github.io") ||
    window.location.protocol === "file:" ||
    (!window.location.port && window.location.protocol !== "http:")
);

// Date ranges
var daysAgoSetting = typeof flaskDaysAgo !== "undefined" ? flaskDaysAgo : "inf";
var isAllTime = (
    daysAgoSetting === "inf" ||
    daysAgoSetting === "infinity" ||
    isNaN(parseInt(daysAgoSetting))
);

var startDate = isAllTime ? new Date(0) : new Date(Date.now() - (parseInt(daysAgoSetting) * 86400000));
var endDate = new Date();

var currentStreamerRawData = null;

$(document).ready(function () {
    chart.render();

    // 1. Initial date presets
    if (isAllTime) {
        $("#startDate").val("");
        $(".btn-preset").removeClass("active");
        $(".btn-preset[data-preset='inf']").addClass("active");
    } else {
        $("#startDate").val(formatDate(startDate));
        $(".btn-preset").removeClass("active");
        $(".btn-preset[data-preset='7d']").addClass("active");
    }
    $("#endDate").val(formatDate(endDate));

    // 2. Restore local preferences
    if (localStorage.getItem("annotations") !== null) {
        $("#annotations").prop("checked", localStorage.getItem("annotations") === "true");
    }
    if (localStorage.getItem("dark-mode") !== null) {
        $("#dark-mode").prop("checked", localStorage.getItem("dark-mode") === "true");
    }
    if (localStorage.getItem("sort-by")) {
        sortBy = localStorage.getItem("sort-by");
        $("#sorting-by").text(sortBy);
        updateSortField();
    }

    applyDarkMode($("#dark-mode").prop("checked"));

    // 3. Event Listeners
    setupEventListeners();

    // 4. Load Analytics Data
    loadDashboardData();

    // 5. Periodic Refresh (default every 5 min)
    var refreshInterval = typeof flaskRefresh !== "undefined" ? flaskRefresh : 300000;
    setInterval(function () {
        loadDashboardData(false);
    }, refreshInterval);
});

function updateSortField() {
    if (sortBy.includes("Points")) sortField = "points";
    else if (sortBy.includes("gain")) sortField = "gain_24h";
    else if (sortBy.includes("activity")) sortField = "last_activity";
    else sortField = "name";
}

function setupEventListeners() {
    // Refresh button
    $("#btn-refresh").click(function () {
        $("#refresh-icon").addClass("fa-spin");
        loadDashboardData(true, function () {
            setTimeout(function () {
                $("#refresh-icon").removeClass("fa-spin");
            }, 600);
        });
    });

    // Toggle header banner
    $("#btn-toggle-header").click(function () {
        $("#header").slideToggle(200);
    });

    // Search Box
    $("#streamer-search").on("input", function () {
        searchTerm = $(this).val().trim().toLowerCase();
        $("#search-clear").toggle(searchTerm.length > 0);
        applyStreamerFilters();
    });

    $("#search-clear").click(function () {
        $("#streamer-search").val("");
        searchTerm = "";
        $(this).hide();
        applyStreamerFilters();
    });

    // Filter Chips
    $(".filter-chips .chip").click(function () {
        $(".filter-chips .chip").removeClass("active");
        $(this).addClass("active");
        activeFilter = $(this).data("filter");
        applyStreamerFilters();
    });

    // Dropdown toggle
    $("#sort-dropdown").click(function (e) {
        e.stopPropagation();
        $(this).toggleClass("is-active");
    });
    $(document).click(function () {
        $("#sort-dropdown").removeClass("is-active");
    });

    // Date Preset Buttons
    $(".btn-preset").click(function () {
        $(".btn-preset").removeClass("active");
        $(this).addClass("active");
        var preset = $(this).data("preset");
        var now = new Date();

        if (preset === "today") {
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            endDate = new Date();
            $("#startDate").val(formatDate(startDate));
            $("#endDate").val(formatDate(endDate));
        } else if (preset === "24h") {
            startDate = new Date(Date.now() - 24 * 3600 * 1000);
            endDate = new Date();
            $("#startDate").val(formatDate(startDate));
            $("#endDate").val(formatDate(endDate));
        } else if (preset === "7d") {
            startDate = new Date(Date.now() - 7 * 86400 * 1000);
            endDate = new Date();
            $("#startDate").val(formatDate(startDate));
            $("#endDate").val(formatDate(endDate));
        } else if (preset === "30d") {
            startDate = new Date(Date.now() - 30 * 86400 * 1000);
            endDate = new Date();
            $("#startDate").val(formatDate(startDate));
            $("#endDate").val(formatDate(endDate));
        } else if (preset === "inf") {
            startDate = new Date(0);
            endDate = new Date();
            $("#startDate").val("");
            $("#endDate").val(formatDate(endDate));
        }

        renderCurrentStreamerChart();
    });

    // Date Inputs
    $("#startDate").change(function () {
        var val = $(this).val();
        startDate = val ? new Date(val) : new Date(0);
        $(".btn-preset").removeClass("active");
        renderCurrentStreamerChart();
    });

    $("#endDate").change(function () {
        var val = $(this).val();
        endDate = val ? new Date(val) : new Date();
        $(".btn-preset").removeClass("active");
        renderCurrentStreamerChart();
    });

    // Toggles
    $("#annotations").change(function () {
        var isChecked = $(this).prop("checked");
        localStorage.setItem("annotations", isChecked);
        updateAnnotations();
    });

    $("#dark-mode").change(function () {
        var isChecked = $(this).prop("checked");
        localStorage.setItem("dark-mode", isChecked);
        applyDarkMode(isChecked);
    });

    $("#toggle-events").change(function () {
        $("#events-box").slideToggle(200);
    });

    // Miner Log viewer toggle
    $("#log").change(function () {
        var isChecked = $(this).prop("checked");
        $("#log-box").toggle(isChecked);
        if (isChecked) {
            getLog();
            $('html, body').animate({ scrollTop: $(document).height() }, 300);
        }
    });

    $("#auto-update-log").click(function () {
        autoUpdateLog = !autoUpdateLog;
        $(this).text(autoUpdateLog ? "⏸️ Pause" : "▶️ Resume");
        if (autoUpdateLog) getLog();
    });
}

function applyDarkMode(isDark) {
    $("#theme-dark").prop("disabled", !isDark);
    chart.updateOptions({
        colors: isDark ? ["#9146FF"] : ["#772ce8"],
        chart: { foreColor: isDark ? "#efeff1" : "#1f1f23" },
        tooltip: { theme: isDark ? "dark" : "light" }
    });
}

// === Data Loading & API Fallback Strategy ===
function loadDashboardData(reselect = false, callback = null) {
    // 1. Fetch summary metrics
    fetchEndpoint("summary.json", "/summary", function (summaryData) {
        if (summaryData && !summaryData.error) {
            updateKPICards(summaryData);
        }
    });

    // 2. Fetch streamers list
    fetchEndpoint("streamers.json", "/streamers", function (streamersData) {
        if (Array.isArray(streamersData) && streamersData.length > 0) {
            streamersList = streamersData;
            sortStreamers();
            applyStreamerFilters();

            // Select streamer: restore previous or pick top
            var saved = localStorage.getItem("selectedStreamer");
            var candidate = streamersList.find(s => s.name === saved);
            if (!currentStreamer || reselect || !candidate) {
                currentStreamer = candidate ? candidate.name : streamersList[0].name;
            }

            selectStreamer(currentStreamer);
        } else {
            $("#streamers-list").html('<li class="loading-item">No streamer records found yet. Run miner to collect stats.</li>');
        }
        if (callback) callback();
    });
}

function fetchEndpoint(staticPath, flaskPath, successCallback) {
    var primaryUrl = isStaticMode ? staticPath : flaskPath;
    var fallbackUrl = isStaticMode ? flaskPath : staticPath;

    $.ajax({
        url: primaryUrl,
        type: "GET",
        dataType: "json",
        cache: false,
        success: function (data) {
            successCallback(data);
        },
        error: function () {
            // Try fallback path
            $.ajax({
                url: fallbackUrl,
                type: "GET",
                dataType: "json",
                cache: false,
                success: function (data) {
                    successCallback(data);
                },
                error: function (err) {
                    console.warn(`Could not fetch ${primaryUrl} or ${fallbackUrl}:`, err);
                }
            });
        }
    });
}

function updateKPICards(summary) {
    if (!summary) return;

    $("#kpi-total-points").text(millify(summary.total_points || 0));
    $("#kpi-total-points-raw").text(`${formatNumber(summary.total_points || 0)} pts total`);

    var gain = summary.gain_24h || 0;
    $("#kpi-24h-gain").text(gain > 0 ? `+${millify(gain)}` : "0");
    $("#kpi-24h-sub").text(gain > 0 ? `+${formatNumber(gain)} pts in 24h` : "No gains in past 24h");

    $("#kpi-streamers-count").text(summary.streamers_count || 0);
    $("#kpi-active-today").text(`${summary.active_today_count || 0} active today`);

    if (summary.top_streamer) {
        $("#kpi-top-streamer").text(summary.top_streamer.name);
        $("#kpi-top-streamer-points").text(`${millify(summary.top_streamer.points || 0)} pts`);
    }

    if (summary.last_sync_time) {
        var syncDate = new Date(summary.last_sync_time);
        $("#last-sync-time").text(`Last update: ${formatRelativeTime(syncDate.getTime())} (${syncDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`);
    } else {
        $("#last-sync-time").text("Sync: Connected");
    }
}

function sortStreamers() {
    var asc = sortBy.includes("ascending");
    streamersList.sort((a, b) => {
        var va = a[sortField];
        var vb = b[sortField];
        if (typeof va === "string") {
            return asc ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return asc ? (va - vb) : (vb - va);
    });
}

function changeSortBy(element) {
    sortBy = element.innerText.trim();
    $("#sorting-by").text(sortBy);
    localStorage.setItem("sort-by", sortBy);
    updateSortField();
    sortStreamers();
    applyStreamerFilters();
}

function applyStreamerFilters() {
    var now_ms = Date.now();
    var ms_24h = 24 * 3600 * 1000;

    filteredStreamers = streamersList.filter(streamer => {
        // Search filter
        if (searchTerm && !streamer.name.toLowerCase().includes(searchTerm)) {
            return false;
        }

        // Chip filters
        if (activeFilter === "active") {
            return streamer.active_today || (now_ms - (streamer.last_activity || 0)) <= ms_24h;
        }
        return true;
    });

    if (activeFilter === "top10") {
        filteredStreamers = filteredStreamers.slice(0, 10);
    }

    $("#streamers-count-badge").text(filteredStreamers.length);
    renderStreamersList();
}

function renderStreamersList() {
    var $list = $("#streamers-list");
    $list.empty();

    if (filteredStreamers.length === 0) {
        $list.html('<li class="loading-item">No matching streamers found.</li>');
        return;
    }

    var now_ms = Date.now();
    var ms_24h = 24 * 3600 * 1000;

    filteredStreamers.forEach(streamer => {
        var isActive = currentStreamer === streamer.name;
        var activeClass = isActive ? "is-active" : "";
        var isOnline = (now_ms - (streamer.last_activity || 0)) <= ms_24h;
        var dotClass = isOnline ? "active" : "";

        var gainBadge = (streamer.gain_24h && streamer.gain_24h > 0)
            ? `<span class="streamer-gain-pill">+${millify(streamer.gain_24h)}</span>`
            : "";

        var item = `
            <li id="streamer-${streamer.name}" class="${activeClass}" onClick="selectStreamer('${streamer.name}')">
                <div class="streamer-item-left">
                    <span class="streamer-dot ${dotClass}" title="${isOnline ? 'Active today' : 'Offline'}"></span>
                    <span class="streamer-item-name">${streamer.name}</span>
                </div>
                <div class="streamer-item-right">
                    ${gainBadge}
                    <span class="streamer-points-badge">${millify(streamer.points || 0)}</span>
                </div>
            </li>
        `;
        $list.append(item);
    });

    // Ensure active streamer is visible
    if (currentStreamer) {
        var el = document.getElementById(`streamer-${currentStreamer}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
}

function selectStreamer(streamerName) {
    if (!streamerName) return;
    currentStreamer = streamerName;
    localStorage.setItem("selectedStreamer", currentStreamer);

    // Update active highlight in sidebar
    $(".streamers-list li").removeClass("is-active");
    $(`#streamer-${streamerName}`).addClass("is-active");

    // Fetch streamer full data
    loadStreamerDetails(streamerName);
}

function loadStreamerDetails(streamerName) {
    var cleanName = streamerName.replace(".json", "");
    var staticUrl = `data/${cleanName}.json`;
    var flaskUrl = `/json/${cleanName}`;

    fetchEndpoint(staticUrl, flaskUrl, function (response) {
        if (!response || response.error) {
            console.warn(`No data for ${streamerName}`);
            return;
        }

        currentStreamerRawData = response;

        // Update spotlight banner
        updateSpotlightBanner(cleanName, response);

        // Render ApexChart
        renderCurrentStreamerChart();

        // Update recent events feed table
        updateRecentEventsTable(cleanName, response);
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
    $("#spotlight-link").attr("href", `https://twitch.tv/${name}`);
    $("#spotlight-points").html(`<i class="fas fa-coins"></i> ${formatNumber(currentPts)} pts`);

    var gain24h = meta.gain_24h || 0;
    $("#spotlight-gain-24h").html(`<i class="fas fa-arrow-up"></i> +${formatNumber(gain24h)} 24h`);
    $("#spotlight-gain-total").html(`<i class="fas fa-history"></i> +${formatNumber(totalGain)} all-time`);
    $("#spotlight-last-active").html(`<i class="far fa-clock"></i> ${formatRelativeTime(lastActive)}`);

    // Category breakdown counts
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

function renderCurrentStreamerChart() {
    if (!currentStreamerRawData || !currentStreamer) return;

    var startMs = (startDate && !isNaN(startDate.getTime())) ? startDate.getTime() : 0;
    var endMs = (endDate && !isNaN(endDate.getTime())) ? new Date(endDate).setHours(23, 59, 59, 999) : Infinity;

    var rawSeries = currentStreamerRawData.series || [];
    var filteredSeries = rawSeries.filter(pt => pt.x >= startMs && pt.x <= endMs);

    // If no points in timeframe, show straight baseline
    if (filteredSeries.length === 0 && rawSeries.length > 0) {
        var lastKnownBalance = rawSeries[rawSeries.length - 1].y;
        filteredSeries = [
            { x: startMs || rawSeries[0].x, y: lastKnownBalance, z: "No Stream" },
            { x: endMs !== Infinity ? endMs : Date.now(), y: lastKnownBalance, z: "No Stream" }
        ];
    }

    // Format series data for ApexCharts: [[timestamp, y], ...] or [{x, y, z}]
    var chartSeriesData = filteredSeries.map(pt => ({
        x: pt.x,
        y: pt.y,
        z: pt.z || "Watch"
    }));

    chart.updateOptions({
        title: {
            text: `${currentStreamer}'s Channel Points Growth`,
            align: "left",
            style: { color: "#bf94ff", fontSize: "16px", fontWeight: "700" }
        }
    });

    chart.updateSeries([
        {
            name: currentStreamer,
            data: chartSeriesData
        }
    ], true);

    // Annotations
    clearAnnotations();
    var rawAnnotations = currentStreamerRawData.annotations || [];
    annotations = rawAnnotations.filter(ann => ann.x >= startMs && ann.x <= endMs);
    updateAnnotations();
}

function updateAnnotations() {
    if ($("#annotations").prop("checked") === true) {
        clearAnnotations();
        if (annotations && annotations.length > 0) {
            annotations.forEach((annotation, index) => {
                annotation["id"] = `ann-${index}`;
                chart.addXaxisAnnotation(annotation, true);
            });
        }
    } else {
        clearAnnotations();
    }
}

function clearAnnotations() {
    if (annotations && annotations.length > 0) {
        annotations.forEach((annotation) => {
            if (annotation.id) chart.removeAnnotation(annotation.id);
        });
    }
    chart.clearAnnotations();
}

function updateRecentEventsTable(streamerName, data) {
    var $tbody = $("#events-table-body");
    var series = data.series || [];

    if (series.length === 0) {
        $tbody.html('<tr><td colspan="5" class="has-text-centered">No event points found.</td></tr>');
        return;
    }

    // Grab latest 50 events in reverse order
    var recent = series.slice().reverse().slice(0, 50);
    var rows = "";

    recent.forEach((item, index) => {
        var prevItem = (index < recent.length - 1) ? recent[index + 1] : null;
        var diff = prevItem ? (item.y - prevItem.y) : 0;
        var diffText = diff > 0 ? `+${formatNumber(diff)}` : (diff < 0 ? `${formatNumber(diff)}` : "--");

        var eventTime = new Date(item.x).toLocaleString();
        var reason = item.z || "Watch";

        rows += `
            <tr>
                <td><small>${eventTime}</small></td>
                <td><b>${streamerName}</b></td>
                <td><span class="tag is-dark is-small">${reason}</span></td>
                <td class="${diff >= 0 ? 'event-points-gain' : ''}">${diffText}</td>
                <td><b>${formatNumber(item.y)}</b></td>
            </tr>
        `;
    });

    $tbody.html(rows);
    $("#events-count-tag").text(`Showing ${recent.length} recent events`);
}

// === Miner Terminal Log Streaming (Flask mode) ===
var isLogCheckboxChecked = false;
var autoUpdateLog = true;
var lastReceivedLogIndex = 0;

function getLog() {
    if ($("#log").prop("checked")) {
        $.get(`/log?lastIndex=${lastReceivedLogIndex}`, function (data) {
            if (data) {
                $("#log-content").append(data);
                $("#log-content").scrollTop($("#log-content")[0].scrollHeight);
                lastReceivedLogIndex += data.length;
            }
            if (autoUpdateLog) {
                setTimeout(getLog, 2000);
            }
        }).fail(function () {
            if (isStaticMode) {
                $("#log-content").text("Note: Live terminal log streaming is available when viewing via local Flask server (host:port). On GitHub Pages, historical chart analytics are permanently synchronized from Kaggle.");
            }
        });
    }
}
