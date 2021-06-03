import { __ } from 'i18n';
import { api } from "@converse/headless/core";
import { html } from "lit";


export default (o) => {
    const unread_msgs = __('You have unread messages');
    const label_message = o.composing_spoiler ? __('Hidden message') : __('Message');
    const label_spoiler_hint = __('Optional hint');
    const show_send_button = api.settings.get('show_send_button');

    return html`
        ${ (o.scrolled && o.num_unread) ? html`<div class="new-msgs-indicator" @click=${ev => o.viewUnreadMessages(ev)}>▼ ${ unread_msgs } ▼</div>` : '' }
        <form class="setNicknameButtonForm hidden">
            <input type="submit" class="btn btn-primary" name="join" value="Join"/>
        </form>
        <form class="sendXMPPMessage">
            <span class="chat-toolbar no-text-select"></span>
            <input type="text" placeholder="${label_spoiler_hint || ''}" value="${o.hint_value || ''}" class="${o.composing_spoiler ? '' : 'hidden'} spoiler-hint"/>

            <div class="suggestion-box">
                <ul class="suggestion-box__results suggestion-box__results--above" hidden=""></ul>
                <textarea
                    autofocus
                    type="text"
                    @drop=${o.onDrop}
                    @input=${o.inputChanged}
                    @keydown=${o.onKeyDown}
                    @keyup=${o.onKeyUp}
                    @paste=${o.onPaste}
                    @change=${o.onChange}
                    class="chat-textarea suggestion-box__input
                        ${ show_send_button ? 'chat-textarea-send-button' : '' }
                        ${ o.composing_spoiler ? 'spoiler' : '' }"
                    placeholder="${label_message}">${ o.message_value || '' }</textarea>
                <span class="suggestion-box__additions visually-hidden" role="status" aria-live="assertive" aria-relevant="additions"></span>
            </div>
        </form>`;
}
