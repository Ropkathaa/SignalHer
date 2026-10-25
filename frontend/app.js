"use strict";

/* ============================================================
   SIGNALHER — FRONTEND APPLICATION
   Responsive UI, Flask integration, and case-specific timeline.
   ============================================================ */

const API_BASE = "http://127.0.0.1:5000";

const $ = (selector, parent = document) =>
    parent.querySelector(selector);

const $$ = (selector, parent = document) =>
    Array.from(parent.querySelectorAll(selector));

const state = {
    currentScreen: "home",
    currentIncident: null,
    latestAnalysis: null,
    latestTimeline: null,
    timelineGenerating: false,
    timelineRequestId: 0,
    categories: [],
    resources: [],
    backendOnline: false
};


/* ============================================================
   SAFE DOM HELPERS
   ============================================================ */

function addText(parent, tag, value, className = "") {
    const element = document.createElement(tag);

    // Never interpret user-submitted text or API content as HTML.
    element.textContent = String(value ?? "");

    if (className) {
        element.className = className;
    }

    parent.append(element);
    return element;
}

function clearElement(element) {
    if (element) {
        element.replaceChildren();
    }
}

function setBusy(element, busy) {
    if (element) {
        element.setAttribute("aria-busy", String(busy));
    }
}

function showLoading(element, message) {
    if (!element) return;

    clearElement(element);
    setBusy(element, true);
    addText(element, "p", message);
}

function showError(element, message) {
    if (!element) return;

    clearElement(element);
    setBusy(element, false);

    const error = addText(
        element,
        "p",
        message,
        "error-message"
    );

    error.setAttribute("role", "alert");
}

function showEmptyState(element, title, message) {
    if (!element) return;

    clearElement(element);
    setBusy(element, false);

    const box = document.createElement("div");
    box.className = "empty-state";

    addText(box, "h3", title);
    addText(box, "p", message);

    element.append(box);
}

function updateTimelineActions() {
    // Timeline generation is automatic after Continue on Findings.
    // Keep the legacy button hidden to avoid a second generation path.
    const actions = $("#timelineActions");
    const button = $("#timelineButton");

    if (actions) {
        actions.hidden = true;
    }

    if (button) {
        button.hidden = true;
        button.disabled = Boolean(state.timelineGenerating);
    }
}

function readableKey(key) {
    return String(key)
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, character => character.toUpperCase());
}

function normaliseTimelineText(value) {
    return String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
}


/* ============================================================
   FLASK API CLIENT
   ============================================================ */

async function apiRequest(path, options = {}) {
    const fetchOptions = {
        method: options.method || "GET",
        headers: {
            Accept: "application/json"
        }
    };

    if (options.body !== undefined) {
        fetchOptions.headers["Content-Type"] = "application/json";
        fetchOptions.body = JSON.stringify(options.body);
    }

    let response;

    try {
        response = await fetch(
            `${API_BASE}${path}`,
            fetchOptions
        );
    } catch {
        throw new Error(
            "SignalHer cannot reach the local backend. " +
            "Check that the Jupyter/Flask server is running at " +
            "127.0.0.1:5000."
        );
    }

    const rawResponse = await response.text();
    let data;

    try {
        data = rawResponse ? JSON.parse(rawResponse) : {};
    } catch {
        throw new Error(
            `The backend returned an unreadable response ` +
            `(HTTP ${response.status}).`
        );
    }

    if (!response.ok) {
        throw new Error(
            data.error ||
            `The backend request failed (HTTP ${response.status}).`
        );
    }

    return data;
}


/* ============================================================
   MULTI-SCREEN NAVIGATION
   ============================================================ */

function navigateTo(screenName) {
    const target = $(`#screen-${screenName}`);

    if (!target) {
        console.error(`SignalHer screen not found: ${screenName}`);
        return;
    }

    $$(".screen").forEach(screen => {
        const selected = screen.dataset.screen === screenName;

        screen.classList.toggle("active", selected);
        screen.hidden = !selected;
    });

    // Keep desktop and mobile navigation synchronised.
    $$("[data-nav-target]").forEach(button => {
        const selected = button.dataset.navTarget === screenName;

        button.classList.toggle("active", selected);

        if (selected) {
            button.setAttribute("aria-current", "page");
        } else {
            button.removeAttribute("aria-current");
        }
    });

    state.currentScreen = screenName;

    target.focus({ preventScroll: true });
}

function bindNavigation() {
    $$("[data-nav-target]").forEach(button => {
        button.addEventListener("click", event => {
            event.preventDefault();

            const destination = button.dataset.navTarget;

            // If there is an analysed incident, opening Timeline from
            // navigation also prepares the review automatically.
            if (
                destination === "timeline" &&
                state.currentIncident &&
                state.latestAnalysis
            ) {
                openTimelineReview();
                return;
            }

            navigateTo(destination);
        });
    });

    $$("[data-open-screen]").forEach(button => {
        button.addEventListener("click", () => {
            const destination = button.dataset.openScreen;

            if (destination === "timeline") {
                openTimelineReview();
                return;
            }

            navigateTo(destination);
        });
    });
}

async function openTimelineReview() {
    if (!state.currentIncident || !state.latestAnalysis) {
        navigateTo("analyze");

        showError(
            $("#analysisResult"),
            "Please analyse a message before opening its timeline review."
        );

        return;
    }

    navigateTo("timeline");
    await requestTimeline();
}


/* ============================================================
   DATE AND INCIDENT PAYLOAD
   ============================================================ */

function getLocalDateTimeValue(date = new Date()) {
    const localDate = new Date(
        date.getTime() - date.getTimezoneOffset() * 60000
    );

    return localDate.toISOString().slice(0, 16);
}

function formatTimestampWithLocalOffset(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new Error(
            "Please enter a valid incident date and time."
        );
    }

    // Preserve the local timezone offset in the submitted timestamp.
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absoluteOffset = Math.abs(offsetMinutes);

    const hours = String(
        Math.floor(absoluteOffset / 60)
    ).padStart(2, "0");

    const minutes = String(
        absoluteOffset % 60
    ).padStart(2, "0");

    return `${value}:00${sign}${hours}:${minutes}`;
}

function getIncidentPayload() {
    const message = $("#messageText")?.value.trim() || "";
    const dateValue = $("#occurredAt")?.value || "";

    if (!message) {
        throw new Error("Please enter a message to analyse.");
    }

    if (message.length > 2000) {
        throw new Error(
            "The message cannot exceed 2,000 characters."
        );
    }

    if (!dateValue) {
        throw new Error(
            "Please select the incident date and time."
        );
    }

    return {
        platform: $("#platform")?.value || "other",
        occurred_at: formatTimestampWithLocalOffset(dateValue),
        message_text: message,
        user_note: $("#userNote")?.value.trim() || "",
        source_reference: "",
        incident_id: `signalher-${Date.now()}`
    };
}

function updateCharacterCount() {
    const textarea = $("#messageText");
    const counter = $("#characterCount");

    if (textarea && counter) {
        counter.textContent =
            `${textarea.value.length} / ${textarea.maxLength}`;
    }
}

function clearIncidentForm() {
    $("#incidentForm")?.reset();

    state.currentIncident = null;
    state.latestAnalysis = null;
    state.latestTimeline = null;
    state.timelineRequestId += 1;
    state.timelineGenerating = false;

    updateTimelineActions();

    const dateField = $("#occurredAt");

    if (dateField) {
        dateField.value = getLocalDateTimeValue();
    }

    updateCharacterCount();

    const summary = $("#resultsSummary");

    if (summary) {
        summary.textContent = "Your analysis will appear here.";
    }

    showEmptyState(
        $("#analysisResult"),
        "No analysis yet",
        "Submit a message to review its possible warning indicators."
    );

    showEmptyState(
        $("#timelineResult"),
        "No timeline review yet",
        "Submit an incident before requesting a timeline review."
    );

    navigateTo("analyze");
}


/* ============================================================
   MESSAGE ANALYSIS
   ============================================================ */

function bindIncidentForm() {
    const form = $("#incidentForm");

    if (!form) return;

    $("#messageText")?.addEventListener(
        "input",
        updateCharacterCount
    );

    $("#clearIncidentButton")?.addEventListener(
        "click",
        clearIncidentForm
    );

    form.addEventListener("submit", async event => {
        event.preventDefault();

        const output = $("#analysisResult");
        const button = $("#analyzeButton");

        let payload;

        try {
            payload = getIncidentPayload();
        } catch (error) {
            showError(output, error.message);
            return;
        }

        state.currentIncident = payload;
        state.latestAnalysis = null;
        state.latestTimeline = null;
        state.timelineRequestId += 1;
        state.timelineGenerating = false;

        updateTimelineActions();

        showLoading(
            output,
            "Reviewing the message and checking configured indicators..."
        );

        if (button) {
            button.disabled = true;
        }

        try {
            const response = await apiRequest(
                "/api/analyze-incident",
                {
                    method: "POST",
                    body: payload
                }
            );

            if (response?.success === false) {
                throw new Error(
                    response.error || "Message analysis could not be completed."
                );
            }

            state.latestAnalysis = response;

            renderAnalysis(response);
            navigateTo("results");

        } catch (error) {
            navigateTo("analyze");
            showError(output, error.message);

        } finally {
            if (button) {
                button.disabled = false;
            }

            setBusy(output, false);
        }
    });
}


/* ============================================================
   CATEGORY DATA
   ============================================================ */

function extractCategoryLabels(data) {
    let items = [];

    if (Array.isArray(data)) {
        items = data;
    } else if (data && typeof data === "object") {
        for (const key of ["categories", "items", "results"]) {
            if (Array.isArray(data[key])) {
                items = data[key];
                break;
            }
        }
    }

    return items
        .map(item => {
            if (typeof item === "string") {
                return item;
            }

            if (item && typeof item === "object") {
                return (
                    item.label ||
                    item.name ||
                    item.category ||
                    item.id ||
                    ""
                );
            }

            return "";
        })
        .filter(Boolean);
}

async function loadCategories() {
    try {
        const response = await apiRequest("/api/categories");
        state.categories = extractCategoryLabels(response);

    } catch (error) {
        // Other screens can still work if category metadata is unavailable.
        console.warn(
            "SignalHer could not load categories:",
            error.message
        );

        state.categories = [];
    }
}


/* ============================================================
   FINDINGS SCREEN
   ============================================================ */

function renderAnalysis(response) {
    const container = $("#analysisResult");
    const summary = $("#resultsSummary");

    if (!container) return;

    clearElement(container);
    setBusy(container, false);

    const analysis = response.analysis || response;

    const findings = Array.isArray(analysis.findings)
        ? analysis.findings
        : [];

    if (summary) {
        summary.textContent = findings.length
            ? `${findings.length} possible warning indicator(s) were returned. ` +
            "Review the original conversation and its context."
            : "No configured warning indicators were returned. " +
            "This does not establish that the message is safe.";
    }

    if (findings.length === 0) {
        showEmptyState(
            container,
            "No configured indicators returned",
            "A message may still be concerning even when no configured " +
            "rule matches it. Consider the complete context."
        );

        return;
    }

    findings.forEach(finding => {
        const card = document.createElement("article");
        card.className = "finding";

        addText(
            card,
            "span",
            finding.label ||
            finding.rule_id ||
            "Possible warning indicator",
            "finding-label"
        );

        addText(
            card,
            "h3",
            finding.label || finding.category || "Finding"
        );

        if (finding.evidence) {
            addText(
                card,
                "p",
                `Highlighted wording: ${finding.evidence}`,
                "evidence"
            );
        }

        if (finding.explanation) {
            addText(card, "p", finding.explanation);
        }

        if (finding.suggested_action) {
            addText(
                card,
                "p",
                `Suggested next step: ${finding.suggested_action}`
            );
        }

        if (finding.rule_id) {
            addText(
                card,
                "p",
                `Indicator ID: ${finding.rule_id}`,
                "finding-rule-id"
            );
        }

        container.append(card);
    });
}


/* ============================================================
   TIMELINE — CONCISE, CASE-SPECIFIC REPORT
   ============================================================ */

function renderTimeline(response) {
    const container = $("#timelineResult");

    if (!container) return;

    clearElement(container);
    setBusy(container, false);

    const timeline =
        response?.timeline_result ||
        response?.timeline ||
        {};

    const actionPlan =
        response?.action_plan ||
        response?.actionPlan ||
        {};

    const events = Array.isArray(timeline.events)
        ? timeline.events
        : [];

    const findings = events.flatMap(event =>
        Array.isArray(event?.findings)
            ? event.findings
            : []
    );

    const report = document.createElement("article");
    report.className = "timeline-entry";

    addText(report, "h2", "Case review");

    const caseId =
        timeline.case_id ||
        (
            Array.isArray(timeline.linked_case_ids) &&
            timeline.linked_case_ids[0]
        ) ||
        state.currentIncident?.incident_id ||
        "SignalHer current session";

    addText(
        report,
        "p",
        `Case ID: ${caseId}`,
        "timeline-time"
    );

    const event = events[0] || {};

    const platform =
        event.platform ||
        state.currentIncident?.platform ||
        "Not specified";

    const occurredAt =
        event.occurred_at ||
        state.currentIncident?.occurred_at ||
        "Not specified";

    addText(
        report,
        "p",
        `Platform: ${platform} · Date and time: ${occurredAt}`
    );

    const analysis =
        state.latestAnalysis?.analysis ||
        state.latestAnalysis ||
        {};

    const analysisFindings = Array.isArray(analysis.findings)
        ? analysis.findings
        : [];

    const labels = [...new Set(
        (findings.length ? findings : analysisFindings)
            .map(item =>
                item?.label ||
                item?.rule_id ||
                item?.category
            )
            .filter(Boolean)
    )];

    const summary = timeline.summary || (
        labels.length
            ? `The configured checks identified possible indicators related to ` +
            `${labels.join(", ")}. Review the wording and surrounding context; ` +
            "these indicators are not a determination of abuse."
            : "No configured warning pattern matched this message. " +
            "This does not establish that the interaction is safe or harmless."
    );

    const concernSection = document.createElement("section");
    concernSection.className = "timeline-observation";

    addText(
        concernSection,
        "h3",
        "Concern reviewed"
    );

    addText(
        concernSection,
        "p",
        summary
    );

    report.append(concernSection);
    container.append(report);


    // Checks that the backend actually reports as completed.
    const checks = Array.isArray(timeline.checks_performed)
        ? timeline.checks_performed.filter(Boolean)
        : [];

    if (checks.length) {
        const section = document.createElement("section");
        section.className = "timeline-observation";

        addText(section, "h3", "Checks performed");

        const list = document.createElement("ul");

        checks.forEach(check => {
            addText(list, "li", check);
        });

        section.append(list);
        container.append(section);
    }


    // Display any contextual observations once, without repeating text.
    const observations = Array.isArray(timeline.observations)
        ? timeline.observations
        : [];

    const uniqueObservations = [];
    const seenObservations = new Set();

    observations.forEach(observation => {
        const explanation = normaliseTimelineText(
            observation?.explanation ||
            observation?.type ||
            ""
        );

        if (explanation && !seenObservations.has(explanation)) {
            seenObservations.add(explanation);
            uniqueObservations.push(observation);
        }
    });

    if (uniqueObservations.length) {
        const section = document.createElement("section");
        section.className = "timeline-observation";

        addText(section, "h3", "Relevant observations");

        const list = document.createElement("ul");

        uniqueObservations.slice(0, 4).forEach(observation => {
            addText(
                list,
                "li",
                observation.explanation ||
                readableKey(observation.type || "Observation")
            );
        });

        section.append(list);
        container.append(section);
    }


    // Action cards display concrete next steps, without dumping the same
    // nested action-plan object a second time.
    const actions = Array.isArray(actionPlan.actions)
        ? actionPlan.actions
        : [];

    if (actions.length) {
        addText(
            container,
            "h2",
            actionPlan.title || "Suggested next steps"
        );

        const seenActions = new Set();

        actions.forEach(action => {
            if (!action || typeof action !== "object") {
                return;
            }

            const title =
                action.title ||
                action.action_id ||
                "Suggested next step";

            const steps = Array.isArray(action.steps)
                ? action.steps.filter(Boolean)
                : [];

            const signature = normaliseTimelineText(
                `${title} ${steps.join(" ")}`
            );

            if (signature && seenActions.has(signature)) {
                return;
            }

            if (signature) {
                seenActions.add(signature);
            }

            const card = document.createElement("article");
            card.className = "action-card";

            addText(card, "h3", title);

            if (steps.length) {
                const list = document.createElement("ul");

                steps.forEach(step => {
                    addText(list, "li", step);
                });

                card.append(list);

            } else if (action.rationale) {
                addText(card, "p", action.rationale);
            }

            if (action.user_control) {
                addText(card, "p", action.user_control);
            }

            container.append(card);
        });
    }


    // Where the backend supplies them, show relevant official resources.
    const resources = Array.isArray(timeline.official_resources)
        ? timeline.official_resources
        : [];

    const resourceUrls = new Set();

    const uniqueResources = resources.filter(resource => {
        const url = safeHttpsUrl(
            resource?.url ||
            resource?.official_url ||
            ""
        );

        if (!url || resourceUrls.has(url)) {
            return false;
        }

        resourceUrls.add(url);

        // Keep the validated URL in the local response object.
        resource.url = url;

        return true;
    });

    if (uniqueResources.length) {
        const section = document.createElement("section");
        section.className = "timeline-observation";

        addText(
            section,
            "h3",
            "Relevant official resources"
        );

        const list = document.createElement("ul");

        uniqueResources.slice(0, 5).forEach(resource => {
            const item = document.createElement("li");
            const link = document.createElement("a");

            link.href = resource.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";

            link.textContent =
                resource.name || "Open official support resource";

            item.append(link);

            if (resource.purpose) {
                item.append(
                    document.createTextNode(` — ${resource.purpose}`)
                );
            }

            list.append(item);
        });

        section.append(list);
        container.append(section);
    }


    // One concise statement at the end of the review.
    const closingText = timeline.closing_note ||
        "These suggestions are not guarantees and may not fit every situation. " +
        "Your context, safety, and final decisions remain yours.";

    addText(
        container,
        "p",
        closingText,
        "autonomy-note"
    );
}


/* ============================================================
   AUTOMATIC TIMELINE GENERATION
   Triggered by Continue on Findings; no visible Generate button.
   ============================================================ */

async function requestTimeline() {
    const container = $("#timelineResult");

    if (!container) return;

    if (!state.currentIncident || !state.latestAnalysis) {
        navigateTo("analyze");

        showError(
            $("#analysisResult"),
            "Please analyse a message before preparing its timeline review."
        );

        updateTimelineActions();
        return;
    }

    // Reuse a finished report instead of submitting the same incident again.
    if (state.latestTimeline) {
        renderTimeline(state.latestTimeline);
        updateTimelineActions();
        return;
    }

    // Prevent a repeated click from issuing duplicate concurrent requests.
    if (state.timelineGenerating) {
        return;
    }

    const payload = state.currentIncident;
    const requestId = ++state.timelineRequestId;

    // Keep the request body compatible with the working Flask endpoint.
    const requestBody = {
        entries: [
            {
                ...payload,
                direction: "unknown",
                case_id: payload.incident_id ||
                    "signalher-current-session"
            }
        ]
    };

    state.timelineGenerating = true;
    updateTimelineActions();

    showLoading(
        container,
        "Preparing your incident-specific timeline review..."
    );

    try {
        const response = await apiRequest(
            "/api/analyze-timeline",
            {
                method: "POST",
                body: requestBody
            }
        );

        // Do not display a response belonging to an older form submission.
        if (requestId !== state.timelineRequestId) {
            return;
        }

        if (response?.success === false) {
            throw new Error(
                response.error ||
                "Timeline review could not be completed."
            );
        }

        state.latestTimeline = response;
        renderTimeline(response);

    } catch (error) {
        if (requestId !== state.timelineRequestId) {
            return;
        }

        showError(
            container,
            error.message ||
            "Timeline review could not be completed."
        );

    } finally {
        if (requestId === state.timelineRequestId) {
            state.timelineGenerating = false;
            setBusy(container, false);
            updateTimelineActions();
        }
    }
}

function bindTimeline() {
    // Timeline generation is triggered by openTimelineReview().
    // The legacy HTML control remains hidden.
    updateTimelineActions();
}


/* ============================================================
   SAFETY RESOURCES
   ============================================================ */

function extractResourceArray(data) {
    if (Array.isArray(data)) {
        return data;
    }

    if (!data || typeof data !== "object") {
        return [];
    }

    for (const key of ["resources", "items", "results", "data"]) {
        if (Array.isArray(data[key])) {
            return data[key];
        }
    }

    return [];
}

function safeHttpsUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
        return null;
    }

    try {
        const url = new URL(value);

        if (url.protocol !== "https:") {
            return null;
        }

        return url.href;

    } catch {
        return null;
    }
}

function isUnavailableEmergencySite(value) {
    if (typeof value !== "string" || !value.trim()) {
        return false;
    }

    try {
        const hostname = new URL(value).hostname.toLowerCase();

        return hostname === "112.gov.in" ||
            hostname.endsWith(".112.gov.in");

    } catch {
        return false;
    }
}

function isRemovedEmergencyResource(resource) {
    if (!resource || typeof resource !== "object") {
        return false;
    }

    const urlValue =
        resource.official_url ||
        resource.url ||
        resource.website ||
        resource.link ||
        "";

    if (isUnavailableEmergencySite(urlValue)) {
        return true;
    }

    const title = String(
        resource.name ||
        resource.title ||
        resource.resource_name ||
        resource.id ||
        ""
    ).toLowerCase();

    // Keep emergency number guidance in the dedicated emergency panels.
    return (
        /112\.gov\.in/i.test(title) ||
        (
            /\b112\b/.test(title) &&
            /(emergency|helpline|response|erss|number)/i.test(title)
        )
    );
}

function renderResources(data) {
    const container = $("#resourceList");

    if (!container) return;

    clearElement(container);
    setBusy(container, false);

    const resources = extractResourceArray(data)
        .filter(resource => !isRemovedEmergencyResource(resource));

    state.resources = resources;

    if (!resources.length) {
        showEmptyState(
            container,
            "No resources were returned",
            "Check the resource directory in the backend or use Safety Search."
        );

        return;
    }

    resources.forEach(resource => {
        const card = document.createElement("article");
        card.className = "resource-card";

        const title =
            resource.name ||
            resource.title ||
            resource.resource_name ||
            resource.id ||
            "Safety resource";

        addText(card, "h3", title);

        // The current Flask resource records use "purpose".
        const description =
            resource.purpose ||
            resource.description ||
            resource.when_to_use ||
            resource.summary ||
            "";

        if (description) {
            addText(card, "p", description);
        }

        if (resource.eligibility_note) {
            addText(card, "p", resource.eligibility_note);
        }

        const urlValue =
            resource.official_url ||
            resource.url ||
            resource.website ||
            resource.link ||
            "";

        const url = safeHttpsUrl(urlValue);

        if (url) {
            const link = document.createElement("a");

            link.href = url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "Open official resource →";

            card.append(link);
        }

        container.append(card);
    });
}

async function loadResources() {
    const container = $("#resourceList");
    const button = $("#refreshResources");

    if (!container) return;

    showLoading(container, "Loading safety resources...");

    if (button) {
        button.disabled = true;
    }

    try {
        const response = await apiRequest("/api/resources");
        renderResources(response);

    } catch (error) {
        showError(
            container,
            `Could not load safety resources: ${error.message}`
        );

    } finally {
        if (button) {
            button.disabled = false;
        }

        setBusy(container, false);
    }
}

function bindResources() {
    $("#refreshResources")?.addEventListener(
        "click",
        loadResources
    );
}


/* ============================================================
   GOOGLE PROGRAMMABLE SEARCH
   ============================================================ */

function validateGoogleSearchUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
        return null;
    }

    try {
        const url = new URL(value);

        if (
            url.protocol !== "https:" ||
            url.hostname !== "cse.google.com" ||
            !url.pathname.startsWith("/cse")
        ) {
            return null;
        }

        return url.href;

    } catch {
        return null;
    }
}

function bindGoogleSearch() {
    const form = $("#searchForm");

    if (!form) return;

    form.addEventListener("submit", async event => {
        event.preventDefault();

        const output = $("#searchResult");
        const button = $("#googleSearchButton");

        const category =
            $("#searchCategory")?.value || "general";

        clearElement(output);
        setBusy(output, true);

        // Open the tab directly from the click/submit handler to reduce
        // the chance that the browser blocks it as a popup.
        let searchWindow = null;

        try {
            searchWindow = window.open("about:blank", "_blank");

            if (searchWindow) {
                searchWindow.opener = null;
            }

        } catch {
            searchWindow = null;
        }

        if (button) {
            button.disabled = true;
        }

        try {
            const response = await apiRequest(
                "/api/search-query",
                {
                    method: "POST",
                    body: { category }
                }
            );

            const searchUrl = validateGoogleSearchUrl(
                response.search_url
            );

            if (!searchUrl) {
                if (searchWindow && !searchWindow.closed) {
                    searchWindow.close();
                }

                showError(
                    output,
                    "The backend did not return a valid Google search URL."
                );

                return;
            }

            if (searchWindow && !searchWindow.closed) {
                searchWindow.location.replace(searchUrl);

                addText(
                    output,
                    "p",
                    "Google Safety Search has opened in a new tab."
                );

            } else {
                addText(
                    output,
                    "p",
                    "Your browser blocked the new tab. Use the link below."
                );

                const link = document.createElement("a");

                link.href = searchUrl;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.className = "search-link";

                link.textContent =
                    `Open Google Safety Search: ${
                        response.query || "Safety resources"
                    }`;

                output.append(link);
            }

        } catch (error) {
            if (searchWindow && !searchWindow.closed) {
                searchWindow.close();
            }

            showError(output, error.message);

        } finally {
            if (button) {
                button.disabled = false;
            }

            setBusy(output, false);
        }
    });
}


/* ============================================================
   BACKEND HEALTH — DEVELOPER CONSOLE ONLY
   ============================================================ */

async function checkBackend() {
    try {
        await apiRequest("/api/health");

        state.backendOnline = true;

        console.info("SignalHer backend health check passed.");

    } catch (error) {
        state.backendOnline = false;

        console.warn(
            "SignalHer backend health check failed:",
            error.message
        );
    }
}


/* ============================================================
   INITIALISE APPLICATION
   ============================================================ */

async function initialiseSignalHer() {
    bindNavigation();
    bindIncidentForm();
    bindTimeline();
    bindResources();
    bindGoogleSearch();

    const dateField = $("#occurredAt");

    if (dateField && !dateField.value) {
        dateField.value = getLocalDateTimeValue();
    }

    updateCharacterCount();
    updateTimelineActions();
    navigateTo("home");

    // Load each independently so a metadata problem does not stop
    // the other screens from becoming usable.
    await Promise.all([
        checkBackend(),
        loadCategories(),
        loadResources()
    ]);
}

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initialiseSignalHer,
        { once: true }
    );
} else {
    initialiseSignalHer();
}