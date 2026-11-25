    #[test]
    fn pane_actions_keep_their_owner_after_general_labs_integration() {
        let panes = [Pane::General, Pane::Recording, Pane::Handoff, Pane::Storage, Pane::Permissions, Pane::Agents, Pane::Labs, Pane::About];
        for (wire, owners) in [
            (r#"{"action":"check-for-updates"}"#, vec![Pane::About]),
            (r#"{"action":"labs-preference","request":1,"setting":"t3","enabled":true}"#, vec![]),
            (r#"{"action":"set","key":"launchAtLogin","value":true}"#, vec![Pane::General]),
            (r#"{"action":"set","key":"playbackLevel","value":101}"#, vec![]),
            (r#"{"action":"recording-preference","request":1,"key":"transcriber","value":"hex"}"#, vec![Pane::Recording]),
            (r#"{"action":"recording-preference","request":1,"key":"playbackLevel","value":101}"#, vec![]),
            (r#"{"action":"recording-preference","request":1,"key":"launchAtLogin","value":true}"#, vec![]),
            (r#"{"action":"recording-meter","visible":true}"#, vec![Pane::Recording]),
            (r#"{"action":"permission-action","request":1,"intent":{"kind":"recheck"}}"#, vec![Pane::Permissions]),
            (r#"{"action":"agents-preference","request":1,"setting":"autoPaste","enabled":true}"#, vec![]),
            (r#"{"action":"agents-preference","request":2,"setting":"sharing","enabled":true}"#, vec![]),
            (r#"{"action":"labs-preference","request":1,"setting":"streaming","enabled":true}"#, vec![Pane::Labs]),
            (r#"{"action":"labs-preference","request":2,"setting":"autoPaste","enabled":true}"#, vec![]),
            (r#"{"action":"handoff-auto-paste","request":2,"enabled":false}"#, vec![Pane::Handoff]),
            (r#"{"action":"labs-preference","request":3,"setting":"sharing","enabled":true}"#, vec![Pane::Labs]),
            (r#"{"action":"labs-preference","request":4,"setting":"wisprFlow","enabled":true}"#, vec![Pane::Labs]),
            (r#"{"action":"agents-connection","request":4,"connection":null}"#, vec![Pane::Agents]),
            (r#"{"action":"agents-preference","request":3,"setting":"t3","enabled":true}"#, vec![Pane::Agents]),
            (r#"{"action":"agents-preference","request":5}"#, vec![Pane::Agents]),
            (r#"{"action":"agents-preference","request":6,"setting":"video","enabled":true}"#, vec![]),
        ] {
            let action: Action = serde_json::from_str(wire).expect(wire);
            for pane in panes { assert_eq!(admits(pane, &action), owners.contains(&pane), "{wire}: {pane:?}"); }
        }
    }
