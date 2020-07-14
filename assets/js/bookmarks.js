/*jslint browser */
/*globals window, IntersectionObserver, locales, pageLanguage,
    ebSlugify, ebIDsAssigned, ebFingerprintsAssigned, ebIsPositionRelative,
    ebNearestPrecedingSibling, ebTruncatedString, ebToggleClickout */

// A script for managing a user's bookmarks.
// This script waits for setup.js to give elements IDs.
// Then it checks local storage for stored bookmarks,
// and does some housekeeping (e.g. deleting old last-location bookmarks).
// It then reads bookmarks from local storage, and marks the
// relevant bookmarked elements on the page with attributes.
// It then creates a list of bookmarks to show to the user.
// It makes it possible for users to select text in elements to bookmark them.
// It listens for new user bookmarks, and updates the bookmark list
// when a user places a new bookmark.
// It also saves a 'last location' bookmark when a user leaves a page.

// It gives each session an ID, which is a timestamp.
// This 'sessionDate' is stored in session storage, and with each
// bookmark in local storage. For the 'last location' bookmarks,
// we only show the user the most recent last-location bookmark
// whose sessionDate does *not* match the current session's sessionDate.
// That way, the last location is always the last place the user
// visited in their last/previous session.

// TODO
// 1. [DONE] In setup.js, fingerprint IDs for addressing misplaced bookmarks.
// 2. [DONE] To fix last-location behaviour, only show lastLocation of *previous* session:
//    - create a session ID and store in sessionStorage
//    - save lastLocation as session ID
//    - show user most recent lastLocation whose session ID is *not* in sessionStorage
// 3. [DONE] Apply new click-for-modal bookmark UX.
// 4. [DONE] Allow multiple user bookmarks.
// 5. [DONE] Add ability to delete bookmarks, individually or all at once.
// 6. [DONE] Change saving on from beforeunload, since mobile browsers don't support it.
// 7. [DONE] Store and compare an index of latest IDs, so in future we can check
//    if it's is missing any bookmarked IDs. If yes, we know bookmarks have moved.
// 8. [DONE] Use user-selected text as bookmark description
// 9. [DONE] Move set-bookmark button to beside selection
// 10. [DONE] Prompt user to go last location on arrival
// 11. [DONE] Make bookmarked text more prominent, title less so in list
// 12. [DONE] Add subheading option to bookmark description (e.g. h2)
// X. Add ability to share, e.g. button to copy location. Feature needs shaping.
// X. [CAN'T REPLICATE] Fix bug where the first text in a list item that contains
//    a list doesn't trigger a bookmark.
// X. Offer to try to identify missing bookmarks, using data-fingerprint attributes.

// Options
// --------------------------------------
// Which elements should we make bookmarkable?
// By default, anything in #content with an ID.
// Use querySelector strings.
var ebBookmarkableElements = '#content [id]';

// Initialise global variables for general use
var ebCurrentSelection;
var ebCurrentSelectionText;

// Disable bookmarks on browsers that don't support
// what we need to provide them.
function ebBookmarksSupport() {
    'use strict';
    if (window.hasOwnProperty('IntersectionObserver')
            && window.getSelection
            && window.getSelection().toString
            && window.localStorage
            && Storage !== 'undefined') {
        return true;
    } else {
        var bookmarking = document.querySelector('.bookmarks');
        bookmarking.style.display = 'none';
        return false;
    }
}

// Generate and store an index of fingerprints and IDs.
function ebBookmarksCreateFingerprintIndex() {
    'use strict';

    var indexOfBookmarks = {};
    var fingerprintedElements = document.querySelectorAll('[data-fingerprint]');
    fingerprintedElements.forEach(function (element) {
        var elementFingerprint = element.getAttribute('data-fingerprint');
        var elementID = element.id;
        indexOfBookmarks[elementFingerprint] = elementID;
    });
    sessionStorage.setItem('index-of-bookmarks', JSON.stringify(indexOfBookmarks));
}

// Return the indexed ID of an element's fingerprint.
function ebBookmarksFingerprintID(elementID) {
    'use strict';

    // If a bookmark's fingerprint isn't in the index,
    // we know that the bookmarked element has moved,
    // because the document has changed.

    // Get the element
    var element;
    if (document.getElementById(elementID)) {
        element = document.getElementById(elementID);
    } else {
        return false;
    }

    // If we have an element to check, the element has a data-fingerprint,
    // and an index exists, return the ID. Otherwise return false.
    if (element.getAttribute('data-fingerprint')
            && sessionStorage.getItem('index-of-bookmarks')) {

        // Fetch and return the ID for the fingerprint
        var indexOfBookmarks = JSON.parse(sessionStorage.getItem('index-of-bookmarks'));
        var fingerprintToCheck = element.getAttribute('data-fingerprint');
        var indexedID = indexOfBookmarks[fingerprintToCheck];
        if (elementID !== indexedID) {
            window.alert(locales[pageLanguage].bookmarks['bookmarks-shifted-warning']);
        } else {
            return indexedID;
        }
    } else {
        return false;
    }
}

// Prompt user to go to last location
function ebBookmarksLastLocationPrompt(link) {
    'use strict';

    // We need to detect if the user has only just arrived.
    // Checking the history length is unreliable, because
    // browsers differ. So we use sessionStorage to store
    // whether the user has just arrived.
    var newSession;
    if (sessionStorage.getItem('sessionUnderway')) {
        newSession = false;
    } else {
        newSession = true;
        sessionStorage.setItem('sessionUnderway', true);
    }

    // If there is a link to go to, this is a new session,
    // and the prompt string has been set in locales, then prompt.
    if (link && newSession
            && locales[pageLanguage].bookmarks['last-location-prompt']) {


        var prompt = document.createElement('div');
        prompt.classList.add('last-location-prompt');
        prompt.innerHTML = '<a href="' + link + '">'
                + locales[pageLanguage].bookmarks['last-location-prompt']
                + '</a>';
        var bookmarks = document.querySelector('div.bookmarks');
        bookmarks.appendChild(prompt);

        // Add class to animate by. Wait a few milliseconds
        // so that CSS transitions will work.
        window.setTimeout(function () {
            prompt.classList.add('last-location-prompt-open');
        }, 50);

        // Let users hide the prompt
        var closeButton = document.createElement('button');
        closeButton.innerHTML = '&#9587;'; // &#9587; is ╳
        prompt.appendChild(closeButton);

        // Listen for clicks on close
        closeButton.addEventListener('click', function () {
            prompt.remove();
        });
    }
}

// Create a session ID
function ebBookmarksSessionDate() {
    'use strict';
    // If a sessionDate has been set,
    // return the current sessionDate
    if (sessionStorage.getItem('sessionDate')) {
        return sessionStorage.getItem('sessionDate');
    } else {
        // create, set and return the session ID
        var sessionDate = Date.now();
        sessionStorage.setItem('sessionDate', sessionDate);
        return sessionDate;
    }
}

// Clean up last locations of a title
function ebBookmarksCleanLastLocations(bookTitleToClean) {
    'use strict';
    var lastLocations = [];

    // Loop through stored bookmarks and add them to the array.
    Object.keys(localStorage).forEach(function (key) {
        if (key.startsWith('bookmark-') && key.includes('-lastLocation-')) {
            var bookmarkBookTitle = JSON.parse(localStorage.getItem(key)).bookTitle;
            if (bookTitleToClean === bookmarkBookTitle) {
                lastLocations.push(JSON.parse(localStorage.getItem(key)));
            }
        }
    });

    // Only keep the last two elements:
    // the previous session's lastLocation, and this session's one
    lastLocations = lastLocations.slice(Math.max(lastLocations.length - 2, 0));

    // Sort the lastLocations ascending by the number in their sessionDate
    lastLocations.sort(function (a, b) {
        return parseFloat(a.sessionDate) - parseFloat(b.sessionDate);
    });

    // Get the number of lastLocations that are not the current session
    var previousSessionLocations = lastLocations.filter(function (location) {
        if (location.sessionDate !== ebBookmarksSessionDate()) {
            return true;
        }
    }).length;
    // If there are more than one, drop the first of the lastLocations
    if (previousSessionLocations > 1) {
        lastLocations.splice(0, 1);
    }

    // Remove all localStorage entries for this title except those in lastLocations
    Object.keys(localStorage).forEach(function (key) {

        // Assume we'll discard this item unless it's in lastLocations
        var matches = 0;

        if (key.startsWith('bookmark-') && key.includes('-lastLocation-')) {
            var bookmarkBookTitle = JSON.parse(localStorage.getItem(key)).bookTitle;
            if (bookTitleToClean === bookmarkBookTitle) {
                lastLocations.forEach(function (lastLocation) {
                    if (key.includes(lastLocation.sessionDate)) {
                        matches += 1;
                    }
                });
                if (matches === 0) {
                    localStorage.removeItem(key);
                }
            }
        }
    });
}

// Check if bookmark is on the current page
function ebBookmarksCheckForCurrentPage(url) {
    'use strict';

    var pageURL = window.location.href.split('#')[0];
    var bookmarkURL = url.split('#')[0];

    if (pageURL === bookmarkURL) {
        return true;
    }
}

// Mark bookmarks in the document
function ebBookmarksMarkBookmarks(bookmarks) {
    'use strict';

    // Clear existing bookmarks
    var bookmarkedElements = document.querySelectorAll('[data-bookmarked]');
    bookmarkedElements.forEach(function (element) {
        element.removeAttribute('data-bookmarked');
    });

    // Mark bookmarked elements
    bookmarks.forEach(function (bookmark) {
        var elementToMark = document.getElementById(bookmark.id);

        // If this bookmark is on the current page,
        // mark the relevant bookmarked element.
        if (ebBookmarksCheckForCurrentPage(bookmark.location)) {
            elementToMark.setAttribute('data-bookmarked', 'true');

            // If the element has already been marked as a user bookmark,
            // leave it a user bookmark. They trump last locations.
            if (elementToMark.getAttribute('data-bookmark-type') === 'userBookmark') {
                elementToMark.setAttribute('data-bookmark-type', 'userBookmark');
            } else {
                elementToMark.setAttribute('data-bookmark-type', bookmark.type);
            }

            ebBookmarksToggleButtonOnElement(elementToMark);
        }
    });
}

// List bookmarks for user
function ebBookmarksListBookmarks(bookmarks) {
    'use strict';

    // Get the bookmarks lists
    var bookmarksList = document.querySelector('.bookmarks-list ul');
    var lastLocationsList = document.querySelector('.last-locations-list ul');

    // Clear the current list
    if (bookmarksList) {
        bookmarksList.innerHTML = '';
    }
    if (lastLocationsList) {
        lastLocationsList.innerHTML = '';
    }

    // A variable to store the first, i.e. most recent, last-location link
    var lastLocationLink;

    // Add all the bookmarks to it
    bookmarks.forEach(function (bookmark) {

        // Clean last locations
        ebBookmarksCleanLastLocations(bookmark.bookTitle);

        // If lastLocation and it's the same session, then
        // quit, because we only want the previous session's last location
        if (bookmark.type === 'lastLocation'
                && bookmark.sessionDate === ebBookmarksSessionDate()) {
            return;
        }

        // Create list item
        var listItem = document.createElement('li');
        listItem.setAttribute('data-bookmark-type', bookmark.type);

        // Add the page title
        if (bookmark.pageTitle) {
            var page = document.createElement('span');
            page.classList.add('bookmark-page');
            page.innerHTML = '<a href="' + bookmark.location + '">'
                    + bookmark.pageTitle
                    + '</a>';
            listItem.appendChild(page);
        }

        // Add the section heading, if any
        if (bookmark.sectionHeading) {
            var sectionHeading = document.createElement('span');
            sectionHeading.classList.add('bookmark-section');
            sectionHeading.innerHTML = '<a href="' + bookmark.location + '">'
                    + bookmark.sectionHeading
                    + '</a>';
            listItem.appendChild(sectionHeading);
        }

        // Add the description
        if (bookmark.description) {
            var description = document.createElement('span');
            description.classList.add('bookmark-description');
            description.innerHTML = bookmark.description;
            listItem.appendChild(description);
        }

        // Add title span with link
        if (bookmark.bookTitle) {
            var title = document.createElement('span');
            title.classList.add('bookmark-title');
            title.innerHTML = '<a href="' + bookmark.location + '">'
                    + bookmark.bookTitle
                    + '</a>';
            listItem.appendChild(title);
        }

        // Format the bookmark date from sessionDate,
        // then add it to the listItem. Leave locale undefined,
        // so that the user gets their default locale's format.
        if (bookmark.sessionDate) {
            var readableSessionDate = new Date(Number(bookmark.sessionDate))
                .toLocaleDateString(undefined, {
                    // weekday: 'long',
                    // hour: 'numeric',
                    // minute: 'numeric',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            var date = document.createElement('span');
            date.classList.add('bookmark-date');
            date.innerHTML = '<a href="' + bookmark.location + '">'
                    + readableSessionDate
                    + '</a>';
            listItem.appendChild(date);
        }

        // Add a delete button and listen for clicks on it
        var deleteButton = document.createElement('button');
        deleteButton.classList.add('bookmark-delete');
        deleteButton.innerHTML = locales[pageLanguage].bookmarks['delete-bookmark'];
        listItem.appendChild(deleteButton);
        deleteButton.addEventListener('click', function () {
            ebBookmarksDeleteBookmark(bookmark);
        });

        // Add the list item to the list
        if (bookmark.type === 'lastLocation') {
            lastLocationsList.appendChild(listItem);
        } else {
            bookmarksList.appendChild(listItem);
        }

        // If the lastLocationLink isn't yet set, set it because
        // this iteration in the loop must be the most recent lastLocation.
        if (bookmark.type === 'lastLocation' && lastLocationLink === undefined) {
            lastLocationLink = bookmark.location;
        }
    });

    // Add button to delete all bookmarks
    var deleteAllBookmarksListItem = document.createElement('li');
    deleteAllBookmarksListItem.classList.add('bookmarks-delete-all');
    var deleteAllBookmarksButton = document.createElement('button');
    deleteAllBookmarksButton.innerHTML = locales[pageLanguage].bookmarks['delete-all'];
    deleteAllBookmarksListItem.appendChild(deleteAllBookmarksButton);
    bookmarksList.appendChild(deleteAllBookmarksListItem);
    deleteAllBookmarksButton.addEventListener('click', function () {
        ebBookmarksDeleteAllBookmarks('userBookmark');
    });

    // Copy to the last-locations list, too
    var deleteAllBookmarksListItemLastLocations = deleteAllBookmarksListItem.cloneNode(true);
    lastLocationsList.appendChild(deleteAllBookmarksListItemLastLocations);
    deleteAllBookmarksListItemLastLocations.addEventListener('click', function () {
        ebBookmarksDeleteAllBookmarks('lastLocation');
    });

    // Prompt the user about their last location
    ebBookmarksLastLocationPrompt(lastLocationLink);
}

// Check if a page has bookmarks
function ebBookmarksCheckForBookmarks() {
    'use strict';

    // Create an empty array to write to
    // when we read the localStorage bookmarks strings
    var bookmarks = [];

    // Loop through stored bookmarks and clean out old ones.
    Object.keys(localStorage).forEach(function (key) {
        if (key.startsWith('bookmark-')) {
            var entry = JSON.parse(localStorage.getItem(key));
            if (entry) {
                var title = entry.bookTitle;
                ebBookmarksCleanLastLocations(title);
            }
        }
    });

    // Now loop through the remaining stored bookmarks and add them to the array.
    Object.keys(localStorage).forEach(function (key) {
        if (key.startsWith('bookmark-')) {
            var bookmark = JSON.parse(localStorage.getItem(key));

            // Add any bookmark that isn't a last-location,
            // only last-locations that are not from the current session.
            if (bookmark.type !== 'lastLocation') {
                bookmarks.push(bookmark);
            } else if (bookmark.sessionDate !== ebBookmarksSessionDate()) {
                bookmarks.push(bookmark);
            }
        }
    });

    // Mark them in the document
    ebBookmarksMarkBookmarks(bookmarks);

    // List them for the user
    ebBookmarksListBookmarks(bookmarks);
}

// Delete a bookmark
function ebBookmarksDeleteBookmark(bookmark) {
    'use strict';

    // Ask user to confirm
    var userConfirmsDelete =
            window.confirm(locales[pageLanguage].bookmarks['delete-bookmark-warning']);

    if (userConfirmsDelete === true) {

        // Delete from local storage
        localStorage.removeItem(bookmark.key);
        // Remove the entry from the list
        ebBookmarksCheckForBookmarks();
    }
}

// Delete all bookmarks
function ebBookmarksDeleteAllBookmarks(type) {
    'use strict';

    // Check with user
    var deleteAllUserBookmarksMessage = locales[pageLanguage].bookmarks['delete-all-bookmarks-warning'];
    var deleteAllLastLocationsMessage = locales[pageLanguage].bookmarks['delete-all-last-locations-warning'];
    var deleteAllConfirmation = false;
    if (type === 'lastLocation') {
        deleteAllConfirmation = window.confirm(deleteAllLastLocationsMessage);
    } else {
        deleteAllConfirmation = window.confirm(deleteAllUserBookmarksMessage);
    }

    // Loop through stored bookmarks and delete
    if (deleteAllConfirmation) {
        Object.keys(localStorage).forEach(function (key) {
            if (key.startsWith('bookmark-')) {

                // If a type has been specified, only delete
                // bookmarks of that type. Otherwise,
                // delete all bookmarks of any type.
                var bookmarkType = JSON.parse(localStorage[key]).type;
                if (type) {
                    if (type === bookmarkType) {
                        localStorage.removeItem(key);
                    }
                } else {
                    localStorage.removeItem(key);
                }
            }
        });

        // Refresh the bookmarks lists
        ebBookmarksCheckForBookmarks();
    }
}

// Return the ID of a bookmarkable element
function ebBookmarksElementID(element) {
    'use strict';

    // If we're bookmarking a specified element,
    // i.e. an element was passed to this function,
    // use its hash, otherwise use the first
    // visible element in the viewport.
    if (!element) {
        element = document.querySelector('[data-bookmark="onscreen"]');
    }
    if (element.id) {
        return element.id;
    } else if (window.location.hash) {
        // If for some reason the element has no ID,
        // return the hash of the current window location.
        return window.location.hash;
    } else {
        // And in desperation, use the first element
        // with an ID on the page.
        return document.querySelector('[id]').id;
    }
}

// Create and store bookmark
function ebBookmarksSetBookmark(type, element, description) {
    'use strict';

    // Get fallback description text
    if (!description) {

        // Use the opening characters of the text.
        // Note that textContent includes line breaks etc.
        var descriptionText = element.textContent.trim().replace(/^[\n\s]+/, '');
        description = ebTruncatedString(descriptionText, 120, ' …');
    }

    // Get the page heading and the most recent section heading, if any.
    // If the page starts with an h1, check for an h2.
    // If an h2, check for an h3, up to h4 sections. Otherwise no section heading.
    var pageTitle, sectionHeadingElement, sectionHeading;
    if (document.querySelector('h1')) {
        pageTitle = document.querySelector('h1').textContent;
        if (ebNearestPrecedingSibling(element, 'H2')) {
            sectionHeadingElement = ebNearestPrecedingSibling(element, 'H2');
            sectionHeading = sectionHeadingElement.textContent;

            // If the sectionHeading contains links (e.g. it's an accordion header)
            // only grab the textContent of the first link
            if (sectionHeadingElement.querySelector('a')) {
                sectionHeadingElement = sectionHeadingElement.querySelector('a');
                sectionHeading = sectionHeadingElement.textContent;
            }
        }
    } else if (document.querySelector('h2')) {
        pageTitle = document.querySelector('h2').textContent;
        if (ebNearestPrecedingSibling(element, 'H3')) {
            sectionHeadingElement = ebNearestPrecedingSibling(element, 'H3');
            sectionHeading = sectionHeadingElement.textContent;
            if (sectionHeadingElement.querySelector('a')) {
                sectionHeadingElement = sectionHeadingElement.querySelector('a');
                sectionHeading = sectionHeadingElement.textContent;
            }
        }
    } else if (document.querySelector('h3')) {
        pageTitle = document.querySelector('h3').textContent;
        if (ebNearestPrecedingSibling(element, 'H4')) {
            sectionHeadingElement = ebNearestPrecedingSibling(element, 'H4');
            sectionHeading = sectionHeadingElement.textContent;
            if (sectionHeadingElement.querySelector('a')) {
                sectionHeadingElement = sectionHeadingElement.querySelector('a');
                sectionHeading = sectionHeadingElement.textContent;
            }
        }
    } else {
        pageTitle = document.title;
        sectionHeading = '';
    }

    // Trim the section heading to 50 characters of textContent.
    // Remove from the last space, to end on a full word.
    if (sectionHeading && sectionHeading.length > 50) {
        sectionHeading = ebTruncatedString(sectionHeading, 50, ' …');
    }

    // Create a bookmark object
    var bookmark = {
        sessionDate: ebBookmarksSessionDate(),
        type: type,
        bookTitle: document.body.dataset.title,
        pageTitle: pageTitle,
        sectionHeading: sectionHeading,
        description: description, // potential placeholder for a user-input description
        id: ebBookmarksElementID(element),
        fingerprint: element.getAttribute('data-fingerprint'),
        location: window.location.href.split('#')[0] + '#' + ebBookmarksElementID(element)
    };

    // Set a bookmark named for its type only.
    // So there will only ever be one bookmark of each type saved.
    // To save more bookmarks, make the key more unique.
    // Note that the prefix 'bookmark-' is used in ebBookmarksCheckForBookmarks().
    var bookmarkKey;
    if (bookmark.type === 'lastLocation') {
        bookmarkKey = 'bookmark-'
                + ebSlugify(bookmark.bookTitle)
                + '-'
                + bookmark.type
                + '-'
                + ebBookmarksSessionDate();
    } else {
        bookmarkKey = 'bookmark-'
                + ebSlugify(bookmark.bookTitle)
                + '-'
                + bookmark.type
                + '-'
                + Date.now(); // this makes each userBookmark unique
    }

    // Add the key to the bookmark object for easy reference
    bookmark.key = bookmarkKey;

    // Save the bookmark
    localStorage.setItem(bookmarkKey, JSON.stringify(bookmark));

    // Refresh the bookmarks list.
    // No need to refresh for a lastLocation,
    // since that only applies to the next visit.
    if (type !== 'lastLocation') {
        ebBookmarksCheckForBookmarks();
    }
}

function ebBookmarkUnmarkBookmarkedElements(element) {
    'use strict';
    // Remove any existing bookmarks
    if (element && element.getAttribute('data-bookmarked')) {
        element.removeAttribute('data-bookmarked');
    } else {
        var bookmarkedElements = document.querySelectorAll('[data-bookmarked]');
        bookmarkedElements.forEach(function (element) {
            element.removeAttribute('data-bookmarked');
        });
    }
}

// Mark an element that has been user-bookmarked
function ebBookmarkMarkBookmarkedElement(element) {
    'use strict';

    // Set the new bookmark
    element.setAttribute('data-bookmarked', 'true');
}

// Remove a bookmark by clicking its icon
function ebBookmarksRemoveByIconClick(button) {
    'use strict';
    var bookmarkID = button.parentElement.id;

    // Loop through stored bookmarks,
    // find this one, and delete it
    Object.keys(localStorage).forEach(function (key) {
        if (key.startsWith('bookmark-')) {
            var entry = JSON.parse(localStorage.getItem(key));
            if (entry.id === bookmarkID) {
                ebBookmarksDeleteBookmark(entry);
            }
        }
    });
}

// Listen for bookmark clicks
function ebBookmarksListenForClicks(button) {
    'use strict';
    button.addEventListener('click', function (event) {

        // Don't let click on bookmark trigger accordion-close etc.
        event.stopPropagation();

        // If the bookmark is pending, set the bookmark
        if (button.parentElement.classList.contains('bookmark-pending')) {
            ebBookmarksSetBookmark('userBookmark',
                    button.parentNode, ebCurrentSelectionText.trim());
            ebBookmarkMarkBookmarkedElement(button.parentNode);
            button.parentElement.classList.remove('bookmark-pending');
        } else {
            ebBookmarksRemoveByIconClick(button);
        }
    });
}

// Add a bookmark button to bookmarkable elements
function ebBookmarksToggleButtonOnElement(element, positionX, positionY) {
    'use strict';

    // Exit if no element
    if (!element) {
        return;
    }

    // Get the main bookmark icons from the page,
    var bookmarkIcon = document.querySelector('.bookmark-icon');
    var historyIcon = document.querySelector('.history-icon');

    // Get the type of bookmark we're setting
    var bookmarkType = '';
    if (element.getAttribute('data-bookmark-type')) {
        bookmarkType = element.getAttribute('data-bookmark-type');
    }

    // If the user is setting a bookmark, don't use history icon
    if (element.classList.contains('bookmark-pending')) {
        bookmarkType = 'userBookmark';
    }

    // If the element has no button, add one.
    var button;
    if (!element.querySelector('button.bookmark-button')) {
        // Copy the icon SVG code to our new button.
        button = document.createElement('button');
        button.classList.add('bookmark-button');

        // Set icon based on bookmark type
        if (bookmarkType === 'lastLocation') {
            button.innerHTML = historyIcon.outerHTML;
            button.title = locales[pageLanguage].bookmarks['last-location'];
        } else {
            button.innerHTML = bookmarkIcon.outerHTML;
            button.title = locales[pageLanguage].bookmarks.bookmark;
        }

        // Append the button
        element.insertAdjacentElement('afterbegin', button);

        // Listen for clicks
        ebBookmarksListenForClicks(button);

    // Otherwise, if the element has a last-location icon
    // the user it trying to set a user bookmark, so
    // switch the icon for a user bookmark icon.
    } else if (element.querySelector('button.bookmark-button .history-icon')
            && bookmarkType === 'userBookmark') {
        button = element.querySelector('button.bookmark-button');
        button.innerHTML = bookmarkIcon.outerHTML;

    // Otherwise, if the element needs a user-bookmark button, add it
    } else if (element.querySelector('button.bookmark-button')
            && bookmarkType === 'userBookmark') {
        button = element.querySelector('button.bookmark-button');
        button.innerHTML = bookmarkIcon.outerHTML;

    // Otherwise, if we are placing a bookmark (not jsut
    // showing a pending bookmark icon) add a last-location icon button
    } else if (element.querySelector('button.bookmark-button')
            && bookmarkType === '') {
        button = element.querySelector('button.bookmark-button');
        button.innerHTML = bookmarkIcon.outerHTML;
    } else {
        button = element.querySelector('button.bookmark-button');
        button.innerHTML = historyIcon.outerHTML;
    }

    // Position the button after the selection,
    // on browsers that support custom properties
    if (positionX !== undefined && positionY !== undefined) {

        // If the vertical height is not zero, we have to deduct
        // the height of the button, to align it with the selected text.
        if (positionY > 0) {
            positionY = positionY - button.offsetHeight;
        }

        // To avoid letting the bookmark appear off screen,
        // don't let the horizontal position exceed the width
        // of its parent. The browser doesn't give us the button
        // width in time for us to use it here. So we have to guess.
        var buttonWidth = '30'; // px
        if (button.clientWidth > 0) {
            buttonWidth = button.clientWidth;
        }
        var maxHoritozontalPosition = button.parentElement.clientWidth
                - buttonWidth;
        if (positionX > maxHoritozontalPosition) {
            positionX = maxHoritozontalPosition;
        }

        // Add the positions as CSS variables
        button.setAttribute('style',
                '--bookmark-button-position: absolute;' +
                '--bookmark-button-position-x: ' + positionX + 'px;' +
                '--bookmark-button-position-y: ' + positionY + 'px;');
    } else {
        // Remove prior position settings, e.g. on a second click
        button.removeAttribute('style');
    }
}

// Mark elements in the viewport so we can bookmark them
function ebBookmarksMarkVisibleElements(elements) {
    'use strict';

    // Ensure we only use elements with IDs
    var elementsWithIDs = Array.from(elements).filter(function (element) {
        return element.id !== 'undefined';
    });

    // If IntersectionObserver is supported, create one.
    // In the config, we set rootMargin slightly negative,
    // so that at least a meaningful portion of the element
    // is visible before it gets a bookmark icon.
    var ebBookmarkObserverConfig = {
        rootMargin: '-50px'
    };
    if (window.hasOwnProperty('IntersectionObserver')) {
        var bookmarkObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.setAttribute('data-bookmark', 'onscreen');
                } else {
                    entry.target.setAttribute('data-bookmark', 'offscreen');
                }
            });
        }, ebBookmarkObserverConfig);

        // Observe each image
        elementsWithIDs.forEach(function (element) {
            bookmarkObserver.observe(element);
        });
    } else {
        // If the browser doesn't support IntersectionObserver,
        // maybe this will work -- largely untested code this.
        // Test and fix it if we need old IE support.
        var scrollTop = window.scrollTop;
        var windowHeight = window.offsetHeight;
        elementsWithIDs.forEach(function (element) {
            if (scrollTop <= element.offsetTop
                    && (element.offsetHeight + element.offsetTop) < (scrollTop + windowHeight)
                    && element.dataset['in-view'] === 'false') {
                element.target.setAttribute('data-bookmark', 'onscreen');
                ebBookmarksToggleButtonOnElement(element.target);
            } else {
                element.target.setAttribute('data-bookmark', 'offscreen');
                ebBookmarksToggleButtonOnElement(element.target);
            }
        });
    }
}

// Listen for user interaction to show bookmark button
function ebBookmarksAddButtons(elements, action) {
    'use strict';

    // If an action is specified e.g. 'click',
    // add the button when an element is clicked.
    if (action) {
        elements.forEach(function (element) {
            element.addEventListener(action, function (event) {
                // Toggle the button on the element, currentTarget,
                // (not necessarily the clicked element, which might be a child).
                ebBookmarksToggleButtonOnElement(event.currentTarget);
            });
        });
    }
}

// Open the modal when the bookmarks button is clicked
function ebBookmarksOpenOnClick() {
    'use strict';
    var button = document.querySelector('.bookmarks > .bookmark-icon');
    var modal = document.querySelector('.bookmarks-modal');
    button.addEventListener('click', function () {

        // Toggle the clickable clickOut area
        ebToggleClickout(modal, function () {
            // If the modal is open, close it
            if (document.querySelector('[data-bookmark-modal="open"]')) {
                modal.style.display = 'none';
                modal.setAttribute('data-bookmark-modal', 'closed');

            // Otherwise, show it
            } else {
                modal.style.display = 'flex';
                modal.setAttribute('data-bookmark-modal', 'open');
            }
        });
    });
}

// In addition to CSS hover, mark clicked lists
function ebBookmarkListsOpenOnClick() {
    'use strict';
    var listHeaders = document.querySelectorAll('.bookmarks-list-header, .last-locations-list-header');
    listHeaders.forEach(function (header) {
        header.addEventListener('click', function () {
            if (document.querySelector('.bookmarks-list-header-open')) {

                // Mark the headers ...
                var openHeader = document.querySelector('.bookmarks-list-header-open');
                openHeader.classList.remove('bookmarks-list-header-open');
                header.classList.add('bookmarks-list-header-open');

                // ... and their parents
                openHeader.parentElement.classList.remove('bookmarks-list-open');
                header.parentElement.classList.add('bookmarks-list-open');

                // Firefox doesn't repaint here, forcing users to reclick.
                // Not sure how to handle that here yet.
            }
        });
    });

    // Set default view
    var bookmarksListHeader = document.querySelector('.bookmarks-list-header');
    bookmarksListHeader.classList.add('bookmarks-list-header-open');
}

// Always listen for and store user's text selection
function ebBookmarksListenForTextSelection() {
    'use strict';
    document.onselectionchange = function () {
        // console.log('New selection made');
        ebCurrentSelection = document.getSelection();
        ebCurrentSelectionText = document.getSelection().toString();

        // If the browser supports anchorNode, use that
        // to get the starting element, otherwise second prize
        // we use the focusNode, where the selection ends
        // (IE supports focusNode but maybe not anchorNode)
        var selectedElement;
        if (window.getSelection().anchorNode) {
            selectedElement = window.getSelection().anchorNode;
        } else {
            selectedElement = window.getSelection().focusNode;
        }
        if (typeof selectedElement === 'object') {
            selectedElement = selectedElement.parentElement;
        }
        var bookmarkableElement = selectedElement.closest('[id]');

        // Mark the element as pending a bookmark, so that
        // in CSS we can show the bookmark button
        if (document.querySelector('.bookmark-pending')) {
            var previousBookmarkableElement = document.querySelector('.bookmark-pending');
            previousBookmarkableElement.classList.remove('bookmark-pending');
        }
        if (bookmarkableElement) {
            bookmarkableElement.classList.add('bookmark-pending');

            // Remove pending icon soon if not clicked
            setTimeout(function () {
                bookmarkableElement.classList.remove('bookmark-pending');
            }, 3000);
        }

        // Add the bookmark button. If no text is selected,
        // add the button in the default position. Otherwise,
        // position it at the end of the text selection.
        if (window.getSelection().isCollapsed) {
            ebBookmarksToggleButtonOnElement(bookmarkableElement);
        } else {

            // If the button has a position: relative parent,
            // we want to set its absolute position based on that parent.
            // Otherwise, we can set it relative to the page.
            var positionX, positionY;
            if (ebIsPositionRelative(bookmarkableElement)) {
                var relativeParent = ebIsPositionRelative(bookmarkableElement);
                positionX = window.getSelection().getRangeAt(0).getBoundingClientRect().right
                        - relativeParent.getBoundingClientRect().left;
                positionY = window.getSelection().getRangeAt(0).getBoundingClientRect().bottom
                        - relativeParent.getBoundingClientRect().top;
            } else {
                positionX = window.getSelection().getRangeAt(0).getBoundingClientRect().right
                        + window.pageXOffset;
                positionY = window.getSelection().getRangeAt(0).getBoundingClientRect().bottom
                        + window.pageYOffset;
            }

            ebBookmarksToggleButtonOnElement(bookmarkableElement, positionX, positionY);
        }
    };
}

// Set the lastLocation bookmark
function ebBookmarksSetLastLocation() {
    'use strict';
    if (ebBookmarksElementID()) {
        ebBookmarksSetBookmark('lastLocation',
                document.getElementById(ebBookmarksElementID()));
    }
}

// The main process
function ebBookmarksProcess() {
    'use strict';

    // Set the sessionDate
    ebBookmarksSessionDate();

    // Create the fingerprint index
    ebBookmarksCreateFingerprintIndex();

    // Show the bookmarks controls
    var bookmarksControls = document.querySelector('.bookmarks');
    bookmarksControls.classList.remove('visuallyhidden');
    ebBookmarksOpenOnClick();
    ebBookmarkListsOpenOnClick();

    // Mark which elements are available for bookmarking
    ebBookmarksMarkVisibleElements(document.querySelectorAll(ebBookmarkableElements));
    ebBookmarksAddButtons(document.querySelectorAll(ebBookmarkableElements));

    // Check for bookmarks
    ebBookmarksCheckForBookmarks();

    // Store the last location.
    // We might have done this on beforeunload, when user leaves page,
    // but that isn't supported on many mobile browsers, and may
    // prevent browsers from using in-memory page navigation caches.
    // So we set the lastLocation every 5 seconds.
    window.setInterval(ebBookmarksSetLastLocation, 5000);

    // Listen for text selections for bookmarking
    ebBookmarksListenForTextSelection();
}

// Start bookmarking
function ebBookmarksInit() {
    'use strict';
    // Check for support before running the main process
    if (ebBookmarksSupport()) {
        ebBookmarksProcess();
    }
}

// Load the bookmarks when IDs have been assigned
var ebBookmarksCheckForIDs = window.setInterval(function () {
    'use strict';
    if (ebIDsAssigned === true && ebFingerprintsAssigned === true) {
        ebBookmarksInit();
        clearInterval(ebBookmarksCheckForIDs);
    }
}, 500);
