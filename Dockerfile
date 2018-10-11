FROM ubuntu:16.04

ARG http_proxy
ARG https_proxy
ARG no_proxy

ENV TERM=xterm \
    http_proxy=${http_proxy}   \
    https_proxy=${https_proxy} \
    no_proxy=${no_proxy}

ENV LANG='C.UTF-8'  \
    LC_ALL='C.UTF-8'

ARG USER
ARG TF_ANNOTATION
ENV TF_ANNOTATION=${TF_ANNOTATION}
ARG DJANGO_CONFIGURATION
ENV DJANGO_CONFIGURATION=${DJANGO_CONFIGURATION}

# Install necessary apt packages
RUN apt-get update && \
    apt-get install -yq \
        python-software-properties \
        software-properties-common \
        wget && \
    add-apt-repository ppa:mc3man/xerus-media -y && \
    add-apt-repository ppa:mc3man/gstffmpeg-keep -y && \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -yq \
        apache2 \
        apache2-dev \
        libapache2-mod-xsendfile \
        supervisor \
        ffmpeg \
        gstreamer0.10-ffmpeg \
        libldap2-dev \
        libsasl2-dev \
        python3-dev \
        python3-pip \
        unzip \
        unrar \
        p7zip-full \
        vim && \
    rm -rf /var/lib/apt/lists/*

# Add a non-root user
ENV USER=${USER}
ENV HOME /home/${USER}
WORKDIR ${HOME}
RUN adduser --shell /bin/bash --disabled-password --gecos "" ${USER}

# Install tf annotation if need
COPY cvat/apps/tf_annotation/docker_setup_tf_annotation.sh /tmp/tf_annotation/
COPY cvat/apps/tf_annotation/requirements.txt /tmp/tf_annotation/
ENV TF_ANNOTATION_MODEL_PATH=${HOME}/rcnn/frozen_inference_graph.pb

RUN if [ "$TF_ANNOTATION" = "yes" ]; then \
        /tmp/tf_annotation/docker_setup_tf_annotation.sh; \
    fi

ARG WITH_TESTS
RUN if [ "$WITH_TESTS" = "yes" ]; then \
        wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
        echo 'deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main' | tee /etc/apt/sources.list.d/google-chrome.list && \
        wget -qO- https://deb.nodesource.com/setup_9.x | bash - && \
        apt-get update && \
        DEBIAN_FRONTEND=noninteractive apt-get install -yq \
            google-chrome-stable \
            nodejs && \
        rm -rf /var/lib/apt/lists/*; \
        mkdir tests && cd tests && npm install \
            eslint \
            eslint-detailed-reporter \
            karma \
            karma-chrome-launcher \
            karma-coverage \
            karma-junit-reporter \
            karma-qunit \
            qunit; \
        echo "export PATH=~/tests/node_modules/.bin:${PATH}" >> ~/.bashrc; \
    fi

# Install and initialize CVAT, copy all necessary files
COPY cvat/requirements/ /tmp/requirements/
COPY supervisord.conf mod_wsgi.conf wait-for-it.sh manage.py ${HOME}/
RUN  pip3 install --no-cache-dir -r /tmp/requirements/${DJANGO_CONFIGURATION}.txt
COPY cvat/ ${HOME}/cvat
COPY tests ${HOME}/tests
RUN  chown -R ${USER}:${USER} .

#Increase Apache max upload size
# RUN sed -i -e 's/LimitRequestBody 1073741824/LimitRequestBody 2147483644/g' /tmp/mod_wsgi-localhost:8080:1000/httpd.conf
# -c 'vi /tmp/mod_wsgi-localhost:8080:1000/httpd.conf '

# RUN all commands below as 'django' user
USER ${USER}

RUN mkdir data share media keys logs /tmp/supervisord
RUN python3 manage.py collectstatic

EXPOSE 8080 8443

ENTRYPOINT ["/usr/bin/supervisord"]


