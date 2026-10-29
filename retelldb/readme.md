// the retelldb memory layer, in clawtel's own words.
//
// what a person knows, scoped and citable, for an agent that has to
// talk about real things in real meetings. the split the owner drew:
//
// - pre-call: a scan through what is known, assembled into a brief
//   with a citation on every line. pointers, not files.
// - mid-call: tools. when someone asks "what exactly does it say",
//   the tool returns the ORIGINAL material from the artifact store,
//   verbatim, never a paraphrase of a summary.
//
// the service is python, stdlib only, http. the reason is the shape of
// the work, not taste: the reference memory engine is python (typed
// nodes, graph storage, embedder lanes), the retrieval and (later)
// embedding ecosystem is python-first, and the seam is http, so the
// control plane stays typescript. a rewrite in ts would reimplement a
// library landscape for no product gain.
//
// langflow, decided honestly: it is a real option as a visual layer
// over flows, with an api to run them and mcp in and out. but flows
// live in its database as json, it brings its own server and ui, and
// the sold package would ship that weight twice. the position here:
// langflow is a local inspection and prototyping layer if wanted, and
// this service's tool surface is mcp-shaped so any client (langflow,
// a voice agent, an editor) can plug in without being the critical
// path. behavior that matters stays in code with tests.
//
// scoping is fail-closed: an undeclared surface reads as nothing, an
// anchored node stays home in an unanchored session, another persona
// never leaks, public social material does not ride into a meeting,
// and private nodes only open on private surfaces. dropped nodes come
// back with reasons, never silently.
//
// lanes: lexical retrieval works with zero services and says so. the
// embedder lane is a closed contract until an embedder key exists.
