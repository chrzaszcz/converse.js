import 'plugins/chatview/bottom_panel.js';
import BaseChatView from 'shared/chat/baseview.js';
import UserDetailsModal from 'modals/user-details.js';
import tpl_chatbox from 'templates/chatbox.js';
import tpl_chatbox_head from 'templates/chatbox_head.js';
import { __ } from 'i18n';
import { _converse, api, converse } from '@converse/headless/core';
import { render } from 'lit-html';

const u = converse.env.utils;
const { dayjs } = converse.env;

/**
 * The View of an open/ongoing chat conversation.
 * @class
 * @namespace _converse.ChatBoxView
 * @memberOf _converse
 */
export default class ChatView extends BaseChatView {
    length = 200
    className = 'chatbox hidden'
    is_chatroom = false // Leaky abstraction from MUC

    events = {
        'click .chatbox-navback': 'showControlBox',
        'click .new-msgs-indicator': 'viewUnreadMessages',
    }

    async initialize () {
        const jid = this.getAttribute('jid');
        _converse.chatboxviews.add(jid, this);

        this.model = _converse.chatboxes.get(jid);
        this.initDebounced();

        this.listenTo(_converse, 'windowStateChanged', this.onWindowStateChanged);
        this.listenTo(this.model, 'change:hidden', () => !this.model.get('hidden') && this.afterShown());
        this.listenTo(this.model, 'change:status', this.onStatusMessageChanged);
        this.listenTo(this.model, 'vcard:change', this.renderHeading);
        this.listenTo(this.model.messages, 'change:correcting', this.onMessageCorrecting);

        if (this.model.contact) {
            this.listenTo(this.model.contact, 'destroy', this.renderHeading);
        }
        if (this.model.rosterContactAdded) {
            this.model.rosterContactAdded.then(() => {
                this.listenTo(this.model.contact, 'change:nickname', this.renderHeading);
                this.renderHeading();
            });
        }

        this.listenTo(this.model.presence, 'change:show', this.onPresenceChanged);
        this.render();

        // Need to be registered after render has been called.
        this.listenTo(this.model.messages, 'add', this.onMessageAdded);
        this.listenTo(this.model, 'change:show_help_messages', this.renderHelpMessages);

        await this.model.messages.fetched;
        !this.model.get('hidden') && this.afterShown()
        /**
         * Triggered once the {@link _converse.ChatBoxView} has been initialized
         * @event _converse#chatBoxViewInitialized
         * @type { _converse.HeadlinesBoxView }
         * @example _converse.api.listen.on('chatBoxViewInitialized', view => { ... });
         */
        api.trigger('chatBoxViewInitialized', this);
    }

    render () {
        const result = tpl_chatbox(Object.assign(
            this.model.toJSON(), { 'markScrolled': ev => this.markScrolled(ev) })
        );
        render(result, this);
        this.content = this.querySelector('.chat-content');
        this.help_container = this.querySelector('.chat-content__help');
        this.renderHeading();
        return this;
    }

    getHelpMessages () { // eslint-disable-line class-methods-use-this
        return [
            `<strong>/clear</strong>: ${__('Remove messages')}`,
            `<strong>/close</strong>: ${__('Close this chat')}`,
            `<strong>/me</strong>: ${__('Write in the third person')}`,
            `<strong>/help</strong>: ${__('Show this menu')}`
        ];
    }

    showControlBox () {
        // Used in mobile view, to navigate back to the controlbox
        _converse.chatboxviews.get('controlbox')?.show();
        this.hide();
    }

    showUserDetailsModal (ev) {
        ev.preventDefault();
        api.modal.show(UserDetailsModal, { model: this.model }, ev);
    }

    async generateHeadingTemplate () {
        const vcard = this.model?.vcard;
        const vcard_json = vcard ? vcard.toJSON() : {};
        const i18n_profile = __("The User's Profile Image");
        const avatar_data = Object.assign(
            {
                'alt_text': i18n_profile,
                'extra_classes': '',
                'height': 40,
                'width': 40
            },
            vcard_json
        );
        const heading_btns = await this.getHeadingButtons();
        const standalone_btns = heading_btns.filter(b => b.standalone);
        const dropdown_btns = heading_btns.filter(b => !b.standalone);
        return tpl_chatbox_head(
            Object.assign(this.model.toJSON(), {
                avatar_data,
                'display_name': this.model.getDisplayName(),
                'dropdown_btns': dropdown_btns.map(b => this.getHeadingDropdownItem(b)),
                'showUserDetailsModal': ev => this.showUserDetailsModal(ev),
                'standalone_btns': standalone_btns.map(b => this.getHeadingStandaloneButton(b))
            })
        );
    }

    /**
     * Returns a list of objects which represent buttons for the chat's header.
     * @async
     * @emits _converse#getHeadingButtons
     * @private
     * @method _converse.ChatBoxView#getHeadingButtons
     */
    getHeadingButtons () {
        const buttons = [
            {
                'a_class': 'show-user-details-modal',
                'handler': ev => this.showUserDetailsModal(ev),
                'i18n_text': __('Details'),
                'i18n_title': __('See more information about this person'),
                'icon_class': 'fa-id-card',
                'name': 'details',
                'standalone': api.settings.get('view_mode') === 'overlayed'
            }
        ];
        if (!api.settings.get('singleton')) {
            buttons.push({
                'a_class': 'close-chatbox-button',
                'handler': ev => this.close(ev),
                'i18n_text': __('Close'),
                'i18n_title': __('Close and end this conversation'),
                'icon_class': 'fa-times',
                'name': 'close',
                'standalone': api.settings.get('view_mode') === 'overlayed'
            });
        }
        /**
         * *Hook* which allows plugins to add more buttons to a chat's heading.
         * @event _converse#getHeadingButtons
         * @example
         *  api.listen.on('getHeadingButtons', (view, buttons) => {
         *      buttons.push({
         *          'i18n_title': __('Foo'),
         *          'i18n_text': __('Foo Bar'),
         *          'handler': ev => alert('Foo!'),
         *          'a_class': 'toggle-foo',
         *          'icon_class': 'fa-foo',
         *          'name': 'foo'
         *      });
         *      return buttons;
         *  });
         */
        return _converse.api.hook('getHeadingButtons', this, buttons);
    }

    /**
     * Given a message element, determine wether it should be
     * marked as a followup message to the previous element.
     *
     * Also determine whether the element following it is a
     * followup message or not.
     *
     * Followup messages are subsequent ones written by the same
     * author with no other conversation elements in between and
     * which were posted within 10 minutes of one another.
     * @private
     * @method _converse.ChatBoxView#markFollowups
     * @param { HTMLElement } el - The message element
     */
    markFollowups (el) { // eslint-disable-line class-methods-use-this
        const from = el.getAttribute('data-from');
        const previous_el = el.previousElementSibling;
        const date = dayjs(el.getAttribute('data-isodate'));
        const next_el = el.nextElementSibling;

        if (
            !u.hasClass('chat-msg--action', el) &&
            !u.hasClass('chat-msg--action', previous_el) &&
            !u.hasClass('chat-info', el) &&
            !u.hasClass('chat-info', previous_el) &&
            previous_el.getAttribute('data-from') === from &&
            date.isBefore(dayjs(previous_el.getAttribute('data-isodate')).add(10, 'minutes')) &&
            el.getAttribute('data-encrypted') === previous_el.getAttribute('data-encrypted')
        ) {
            u.addClass('chat-msg--followup', el);
        }
        if (!next_el) {
            return;
        }

        if (
            !u.hasClass('chat-msg--action', el) &&
            u.hasClass('chat-info', el) &&
            next_el.getAttribute('data-from') === from &&
            dayjs(next_el.getAttribute('data-isodate')).isBefore(date.add(10, 'minutes')) &&
            el.getAttribute('data-encrypted') === next_el.getAttribute('data-encrypted')
        ) {
            u.addClass('chat-msg--followup', next_el);
        } else {
            u.removeClass('chat-msg--followup', next_el);
        }
    }

    onPresenceChanged (item) {
        const show = item.get('show');
        const fullname = this.model.getDisplayName();

        let text;
        if (u.isVisible(this)) {
            if (show === 'offline') {
                text = __('%1$s has gone offline', fullname);
            } else if (show === 'away') {
                text = __('%1$s has gone away', fullname);
            } else if (show === 'dnd') {
                text = __('%1$s is busy', fullname);
            } else if (show === 'online') {
                text = __('%1$s is online', fullname);
            }
            text && this.model.createMessage({ 'message': text, 'type': 'info' });
        }
    }

    async close (ev) {
        ev?.preventDefault?.();
        if (_converse.router.history.getFragment() === 'converse/chat?jid=' + this.model.get('jid')) {
            _converse.router.navigate('');
        }
        if (api.connection.connected()) {
            // Immediately sending the chat state, because the
            // model is going to be destroyed afterwards.
            this.model.setChatState(_converse.INACTIVE);
            this.model.sendChatState();
        }
        await this.model.close(ev);
        /**
         * Triggered once a chatbox has been closed.
         * @event _converse#chatBoxClosed
         * @type { _converse.ChatBoxView | _converse.ChatRoomView }
         * @example _converse.api.listen.on('chatBoxClosed', view => { ... });
         */
        api.trigger('chatBoxClosed', this);
        return this;
    }

    afterShown () {
        this.model.clearUnreadMsgCounter();
        this.model.setChatState(_converse.ACTIVE);
        this.scrollDown();
        this.maybeFocus();
    }

    viewUnreadMessages () {
        this.model.save({ 'scrolled': false, 'scrollTop': null });
        this.scrollDown();
    }
}

api.elements.define('converse-chat', ChatView);
