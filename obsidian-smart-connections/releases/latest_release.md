> [!NOTE] Patch v4.1.8
> - Added: "Pin" and "Hide" events/milestones
> 
> All Smart Plugins:
> - Fixed: verified plugin catalog links should work on mobile
> - Fixed: settings groups now re-render when a dropdown changes (prevents stale dependent settings)
> - Improved: notifications modal includes a "Load more" button (beyond the default 100)

> [!NOTE]- Previous patches
> > [!NOTE]- v4.1.7
> > - Added: Links to docs from [milestones](https://smartconnections.app/smart-environment/milestones/?utm_source=release-notes)
> > - Added: Include active source item in context created from the connections view
> > - Fixed: replaced model source for multilingual E5 Small embedding model to ensure quantized variations available
> 
> > [!NOTE]- v4.1.6
> > - Added: milestones feature with modal and checklist components
> > - Added: connections view menu option to copy results as links 
> > - Added: multilingual-e5-small embedding model support
> > - Improved: settings tab with added "learn more" and "help" buttons to settings groups
> > - Fixed: markdown parser should handle frontmatter correctly (prevent false-positive frontmatter detection)
> 
> > [!NOTE]- v4.1.4
> > - Added fallback for opening plugin catalog links in case the button doesn't automatically open the browser as expected
> 
> > [!NOTE]- v4.1.3
> > - Added link to documentation in settings for easier access
> > - Fixed highlight "Reset data" after embedding model change
> 
> > [!NOTE]- v4.1.2
> > - Improved model configuration UX
> >   - Added "Delete" functionality to better manage models
> > - Enhanced UI for settings and improved styling
> > - Improved: Updated score algorithm settings to clarify descriptions
> 
> > [!NOTE]- v4.1.1
> > - Connections codeblock view should render as expected without errors
> 
> 
# Smart Connections `v4`

## What's new in v4

Smart Connections v4 focuses the plugin on a simple promise: install, enable, and AI-powered connections just work. Advanced configuration and power-user workflows are available through Smart Environment and the Smart Plugins catalog.

### Pause connections

Use the new Connections "pause" button to freeze the connections results. This allows you to move through your vault while keeping the connections to a specific note visible while you work.

### Copy connections as list of links

Right-click the connections results to *copy all links* to clipboard.

### Copy all connections content (Context Engineering)

Click the connections view menu button and "Send to Smart Context" (briefcase icon) option. This allows you to quickly copy *all content from the connections* to clipboard for use as context with any AI chat! The Smart Context view also lets you add or remove items before copying all to the clipboard in one-click!

### Pinned connections

In addition to "hiding" connections, you can now "Pin" connections. This ensures the pinned connections are always visible in the connections view, and hidden or pinned state can improve ranking behavior where supported.

### Events and notifications

Important events are now surfaced in a dedicated notifications modal:

- On desktop, click the Smart Env item in the status bar to open the notifications modal.  
- On mobile, a Smart Environment notice appears at the bottom of the Connections view; tap it to review events.

Examples of events you might see:

- Initial indexing complete for your vault  
- Sources reimported after model changes  
- Warnings when exclusions block indexing on specific folders or files  

Objectives of the new Events system:

- make the environment inspectable and understandable
- reduce the number of Obsidian native notifications

### Advanced connections

Advanced connection tools build on Smart Environment to give power users more control.

Advanced features:

- **Inline connections**  
  Small badges in the editor that show how many strong matches a block has, with a pop-over of related blocks and notes.  
- **Footer connections**  
  A persistent panel that updates as you type so high value connections stay visible while you write.  
- **Configurable scoring and ranking**  
  Choose different algorithms for how results are scored and optionally add a rerank stage.  
- **Connections in Bases**  
  Use `score_connection` and `list_connections` in Obsidian Bases to show similarity columns and related note lists in tables.  
- **Advanced filters and models**  
  Extra Smart Environment controls for embeddings, collections, and include or exclude rules.  
- **Experimental workflows**
  New ideas can launch behind settings first so users can shape how they evolve.

These features are built on the same Smart Environment core and are available without paid feature gating.
